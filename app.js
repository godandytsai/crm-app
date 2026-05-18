import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = 'https://trxmfvosyfnlidmyelzs.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyeG1mdm9zeWZubGlkbXllbHpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyMTU5NDUsImV4cCI6MjA5Mzc5MTk0NX0.auFOS6ZtcmhsXMWBctFtRr-KnKmGDh4E5jhnk79Vbx0'
const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

let currentUser = null, currentRep = null, todayRoute = null, visitResult = '成交'
const ACTIVE_REPS = ['廖大新', '陳明祥', '張宏榜']

function avatarColors(i) { return ['av-blue','av-green','av-amber','av-red'][i%4] }
function initials(n='') { return n.replace(/\s/g,'').slice(0,2) }
function haversineKm(a,b,c,d){const R=6371,r=Math.PI/180,dL=(c-a)*r,dG=(d-b)*r,x=Math.sin(dL/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin(dG/2)**2;return Math.round(R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))*1.2*10)/10}
function today() { return new Date().toISOString().slice(0,10) }
function daysAgo(d) { return d ? Math.floor((Date.now()-new Date(d))/86400000) : null }
function visitUrgency(last, interval) {
  const days = daysAgo(last)
  if (days===null) return {cls:'b-danger',label:'從未拜訪'}
  const left = interval - days
  if (left<0) return {cls:'b-danger',label:`逾期 ${Math.abs(left)} 天`}
  if (left<=3) return {cls:'b-warn',label:`${left} 天後到期`}
  return {cls:'b-gray',label:`${left} 天後`}
}
function showError(msg) {
  const el = document.getElementById('login-error')
  el.textContent = msg
  el.style.display = 'block'
  const btn = document.getElementById('btn-login')
  btn.disabled = false
  btn.textContent = '登入'
}

window.handleLogin = async () => {
  const email = document.getElementById('login-email').value.trim()
  const pwd = document.getElementById('login-password').value
  const btn = document.getElementById('btn-login')
  document.getElementById('login-error').style.display = 'none'
  btn.disabled = true
  btn.textContent = '登入中...'

  const { data: authData, error: authErr } = await sb.auth.signInWithPassword({ email, password: pwd })
  if (authErr) { showError('帳號或密碼錯誤'); return }

  const { data: rep, error: repErr } = await sb.from('sales_rep')
    .select('*').eq('auth_user_id', authData.user.id).single()

  if (repErr || !rep) { 
    await sb.auth.signOut()
    showError('找不到對應帳號，請聯繫管理者')
    return 
  }

  currentUser = authData.user
  currentRep = rep
  enterApp()
}

function enterApp() {
  document.getElementById('screen-login').classList.remove('active')
  document.getElementById('screen-main').classList.add('active')
  const badge = document.getElementById('top-role-badge')
  if (currentRep.role === 'manager' || currentRep.role === 'admin') {
    badge.textContent = '管理者'
    badge.className = 'role-badge role-manager'
    document.getElementById('bottom-nav').style.display = 'none'
    renderManagerOverview()
  } else {
    badge.textContent = '業務'
    badge.className = 'role-badge role-sales'
    switchPage('today')
  }
}

window.handleLogout = async () => {
  await sb.auth.signOut()
  currentUser = currentRep = todayRoute = null
  document.getElementById('screen-main').classList.remove('active')
  document.getElementById('screen-login').classList.add('active')
  document.getElementById('login-email').value = ''
  document.getElementById('login-password').value = ''
}

window.switchPage = (page) => {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'))
  const nav = document.getElementById('nav-'+page)
  if (nav) nav.classList.add('active')
  const titles = {today:'今日拜訪',customers:'我的客戶',pending:'待辦清單',stats:'我的數字'}
  document.getElementById('top-title').textContent = titles[page]||''
  if (page==='today') renderToday()
  if (page==='customers') renderCustomers()
  if (page==='pending') renderPending()
  if (page==='stats') renderStats()
}

async function renderToday() {
  const c = document.getElementById('page-content')
  c.innerHTML = '<div class="loading"><div class="spinner"></div> 載入中</div>'
  if (!currentRep) return

  const { data: route } = await sb.from('daily_route')
    .select('*').eq('rep_id', currentRep.id).eq('route_date', today()).maybeSingle()
  
  if (!route) {
    const { data: newRoute } = await sb.from('daily_route')
      .insert({ rep_id: currentRep.id, route_date: today() }).select().single()
    todayRoute = newRoute
  } else {
    todayRoute = route
  }

  const { data: visits } = todayRoute
    ? await sb.from('visit_log').select('*, customer(id,name,type,grade,visit_interval_days)')
        .eq('route_id', todayRoute.id).order('visit_order')
    : { data: [] }

  const closed = (visits||[]).filter(v => v.result==='成交')
  const totalAmt = closed.reduce((s,v) => s+(v.amount||0), 0)
  const sysKm = todayRoute?.system_km || 0

  c.innerHTML = `
    <div class="metric-row">
      <div class="metric-card"><div class="mc-label">今日里程</div><div class="mc-val">${sysKm}<span> km</span></div><div class="mc-sub">預估油資 NT$${Math.round(sysKm*4)}</div></div>
      <div class="metric-card"><div class="mc-label">成交家數</div><div class="mc-val">${closed.length}<span> / ${(visits||[]).length}</span></div><div class="mc-sub">成交率 ${(visits||[]).length?Math.round(closed.length/(visits||[]).length*100):0}%</div></div>
    </div>
    <div class="metric-row">
      <div class="metric-card"><div class="mc-label">今日業績</div><div class="mc-val" style="font-size:17px">NT$${totalAmt.toLocaleString()}</div></div>
      <div class="metric-card"><div class="mc-label">拜訪筆數</div><div class="mc-val">${(visits||[]).length}<span> 筆</span></div></div>
    </div>
    <div class="sec-label">今日拜訪記錄</div>
    <button class="add-btn" onclick="openVisitModal()"><i class="ti ti-plus"></i> 新增拜訪</button>
    ${!(visits||[]).length ? '<div class="empty-state"><i class="ti ti-map-pin"></i>尚無拜訪記錄<br>點上方按鈕新增</div>'
      : (visits||[]).map((v,i) => `
        <div class="card">
          <div class="card-top">
            <div class="avatar ${avatarColors(i)}">${initials(v.customer?.name)}</div>
            <div style="flex:1"><div class="card-name">${v.customer?.name||'-'}</div><div class="card-sub">${v.customer?.type||''} · ${new Date(v.visited_at).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'})}</div></div>
            <span class="badge ${v.result==='成交'?'b-success':v.result==='待跟進'?'b-warn':'b-gray'}">${v.result}</span>
          </div>
          <div class="card-meta">
            ${v.amount?`<span><i class="ti ti-currency-dollar"></i>NT$${v.amount.toLocaleString()}</span>`:''}
            ${v.notes?`<span><i class="ti ti-notes"></i>${v.notes.slice(0,20)}${v.notes.length>20?'...':''}</span>`:''}
          </div>
        </div>`).join('')}
  `
}

async function renderCustomers() {
  const c = document.getElementById('page-content')
  c.innerHTML = '<div class="loading"><div class="spinner"></div> 載入中</div>'
  const { data: customers } = await sb.from('customer').select('*, visit_log(visited_at)').eq('is_active',true).order('name')
  if (!customers?.length) { c.innerHTML = '<div class="empty-state"><i class="ti ti-building-store"></i>尚無客戶資料</div>'; return }
  c.innerHTML = `
    <div class="sec-label">我的客戶 (${customers.length})</div>
    ${customers.map((cu,i) => {
      const lastVisit = cu.visit_log?.sort((a,b)=>new Date(b.visited_at)-new Date(a.visited_at))[0]?.visited_at
      const urg = visitUrgency(lastVisit, cu.visit_interval_days||21)
      return `<div class="card">
        <div class="card-top">
          <div class="avatar ${avatarColors(i)}">${initials(cu.name)}</div>
          <div style="flex:1"><div class="card-name">${cu.name}</div><div class="card-sub">${cu.type||''} · 等級 ${cu.grade}</div></div>
          <span class="badge ${urg.cls}">${urg.label}</span>
        </div>
        <div class="card-meta"><span><i class="ti ti-map-pin"></i>${cu.actual_address||cu.erp_address||'地址未設定'}</span></div>
        ${cu.address_mismatch?'<div class="card-note" style="color:#854F0B"><i class="ti ti-alert-triangle"></i> 地址差異待審核</div>':''}
      </div>`}).join('')}
  `
}

async function renderPending() {
  const c = document.getElementById('page-content')
  c.innerHTML = '<div class="loading"><div class="spinner"></div> 載入中</div>'
  const { data: pending } = await sb.from('visit_log')
    .select('*, customer(name,type), daily_route(route_date)')
    .eq('follow_up_status','pending').order('created_at',{ascending:false})
  const { data: addrLogs } = currentRep ? await sb.from('address_change_log')
    .select('*, customer(name)').eq('rep_id',currentRep.id).eq('status','pending') : {data:[]}
  c.innerHTML = `
    ${addrLogs?.length?`<div class="sec-label">地址待審核</div>${addrLogs.map(log=>`
      <div class="card">
        <div class="card-top"><div class="avatar av-amber">${initials(log.customer?.name)}</div>
        <div style="flex:1"><div class="card-name">${log.customer?.name}</div><div class="card-sub">地址變更提報</div></div>
        <span class="badge b-warn">待審核</span></div>
        <div class="card-note">舊：${log.old_address||'—'}<br>新：${log.new_address}</div>
      </div>`).join('')}`:''}
    <div class="sec-label">待跟進 ${pending?.length?`(${pending.length})`:''}</div>
    ${!pending?.length?'<div class="empty-state"><i class="ti ti-checks"></i>沒有待跟進項目</div>'
      :pending.map((v,i)=>`<div class="card">
        <div class="card-top"><div class="avatar ${avatarColors(i)}">${initials(v.customer?.name)}</div>
        <div style="flex:1"><div class="card-name">${v.customer?.name}</div><div class="card-sub">${v.daily_route?.route_date} 拜訪</div></div>
        <span class="badge b-warn">待跟進</span></div>
        ${v.notes?`<div class="card-note">${v.notes}</div>`:''}
        <div style="display:flex;gap:8px;margin-top:10px"><button class="btn-ghost" onclick="markFollowUpDone('${v.id}')">標記完成</button></div>
      </div>`).join('')}
  `
}

window.markFollowUpDone = async (id) => {
  await sb.from('visit_log').update({follow_up_status:'done'}).eq('id',id)
  renderPending()
}

async function renderStats() {
  const c = document.getElementById('page-content')
  c.innerHTML = '<div class="loading"><div class="spinner"></div> 載入中</div>'
  if (!currentRep) return
  const period = today().slice(0,7)
  const { data: ach } = await sb.from('monthly_achievement').select('*').eq('rep_id',currentRep.id).eq('period',period).maybeSingle()
  const { data: routes } = await sb.from('daily_route').select('approved_km,system_km,gmaps_km').eq('rep_id',currentRep.id).gte('route_date',period+'-01')
  const totalKm = routes?.reduce((s,r)=>s+(r.approved_km||r.gmaps_km||r.system_km||0),0)||0
  const vPct = ach?Math.min(Math.round(ach.visit_pct),100):0
  const aPct = ach?Math.min(Math.round(ach.amount_pct),100):0
  c.innerHTML = `
    <div class="sec-label">本月達成 · ${period}</div>
    <div class="metric-row">
      <div class="metric-card"><div class="mc-label">拜訪家次</div><div class="mc-val">${ach?.actual_visits||0}<span>/${ach?.visit_target||'-'}</span></div></div>
      <div class="metric-card"><div class="mc-label">業績達成</div><div class="mc-val">${aPct}<span>%</span></div></div>
    </div>
    <div class="metric-row">
      <div class="metric-card"><div class="mc-label">累計里程</div><div class="mc-val">${Math.round(totalKm)}<span> km</span></div><div class="mc-sub">油資 NT$${Math.round(totalKm*4)}</div></div>
      <div class="metric-card"><div class="mc-label">累計業績</div><div class="mc-val" style="font-size:16px">NT$${((ach?.actual_amount||0)/1000).toFixed(0)}K</div></div>
    </div>
    <div class="sec-label">進度明細</div>
    <div class="card">
      <div class="prog-wrap"><div class="prog-label"><span>業績達成</span><span>NT$${((ach?.actual_amount||0)/1000).toFixed(0)}K / ${((ach?.amount_target||0)/1000).toFixed(0)}K</span></div><div class="prog-bar"><div class="prog-fill" style="width:${aPct}%;background:#185FA5"></div></div></div>
      <div class="prog-wrap"><div class="prog-label"><span>拜訪家次</span><span>${ach?.actual_visits||0} / ${ach?.visit_target||'-'} 次</span></div><div class="prog-bar"><div class="prog-fill" style="width:${vPct}%;background:#3B6D11"></div></div></div>
    </div>
  `
}

async function renderManagerOverview() {
  document.getElementById('top-title').textContent = '管理者後台'
  const c = document.getElementById('page-content')
  c.innerHTML = '<div class="loading"><div class="spinner"></div> 載入中</div>'

  const todayStr = today()
  const period = todayStr.slice(0,7)
  const monthStart = period + '-01'
  // 近兩個月：上個月和這個月
  const now = new Date()
  const prevDate = new Date(now.getFullYear(), now.getMonth()-1, 1)
  const prevPeriod = prevDate.toISOString().slice(0,7)
  const day90ago = new Date(Date.now()-90*86400000).toISOString().slice(0,10)
  const day30ago = new Date(Date.now()-30*86400000).toISOString().slice(0,10)

  // 平行拉所有資料
  const [
    { data: reps },
    { data: allRoutes },
    { data: allVisits },
    { data: customers },
    { data: addrPending },
    { data: pendingFollowups },
    { data: recentOrders }
  ] = await Promise.all([
    sb.from('sales_rep').select('id,name,role').in('role',['sales','manager']).in('name',ACTIVE_REPS).order('name'),
    sb.from('daily_route').select('id,rep_id,route_date').gte('route_date', monthStart),
    sb.from('visit_log').select('id,route_id,result,amount,notes,visited_at,follow_up_status,customer_id,customer(name)')
      .gte('visited_at', monthStart+'T00:00:00'),
    sb.from('customer').select('id,name,assigned_rep_id,visit_interval_days,is_active,type'),
    sb.from('address_change_log').select('*, customer(name), sales_rep(name)').eq('status','pending'),
    sb.from('visit_log').select('id,route_id,customer_id,notes,visited_at,customer(name),daily_route(route_date,rep_id)')
      .eq('result','待跟進').eq('follow_up_status','pending'),
    // 近90天出貨資料（用來算未交易＆金額趨勢）
    sb.from('sales_order').select('customer_name,amount,year,month,day,order_date')
      .eq('order_type','出貨').gt('amount',0).gte('order_date', day90ago)
  ])

  // ── 建立輔助 map ──
  const routeRepMap = {}
  ;(allRoutes||[]).forEach(r => { routeRepMap[r.id] = r.rep_id })
  const todayRouteRepIds = new Set((allRoutes||[]).filter(r=>r.route_date===todayStr).map(r=>r.rep_id))
  const repMap = {}
  ;(reps||[]).forEach(r => { repMap[r.id] = r })

  // ── 本月業務統計 ──
  const repStats = {}
  ;(reps||[]).filter(r=>r.role==='sales'&&ACTIVE_REPS.includes(r.name)).forEach(r => {
    repStats[r.id] = { name:r.name, id:r.id, visits:0, closed:0, amount:0, notesFilled:0, todayOut:todayRouteRepIds.has(r.id) }
  })
  ;(allVisits||[]).forEach(v => {
    const repId = routeRepMap[v.route_id]
    if (!repId || !repStats[repId]) return
    const s = repStats[repId]
    s.visits++
    if (v.result==='成交') { s.closed++; s.amount += (v.amount||0) }
    if (v.notes?.trim()) s.notesFilled++
  })
  const statsArr = Object.values(repStats).sort((a,b)=>b.amount-a.amount)
  const todayOutCount = statsArr.filter(s=>s.todayOut).length
  const totalVisits = statsArr.reduce((s,r)=>s+r.visits,0)
  const totalClosed = statsArr.reduce((s,r)=>s+r.closed,0)

  // ── sales_order 分析 ──
  // 按客戶名分組，分本月/上月
  const ordersByName = {}
  ;(recentOrders||[]).forEach(o => {
    const k = o.customer_name
    if (!k) return
    if (!ordersByName[k]) ordersByName[k] = { thisMonth:0, lastMonth:0, lastDate:null }
    const ym = String(o.year)+'-'+String(o.month).padStart(2,'0')
    if (ym === period) ordersByName[k].thisMonth += o.amount
    if (ym === prevPeriod) ordersByName[k].lastMonth += o.amount
    const d = o.order_date?.slice(0,10)
    if (d && (!ordersByName[k].lastDate || d > ordersByName[k].lastDate)) ordersByName[k].lastDate = d
  })

  // 久未拜訪（從 visit_log，超過週期）
  const lastVisitMap = {}
  const { data: hist90 } = await sb.from('visit_log').select('customer_id,visited_at')
    .gte('visited_at', day90ago+'T00:00:00')
  ;(hist90||[]).forEach(v => {
    const d = v.visited_at?.slice(0,10)
    if (!d) return
    if (!lastVisitMap[v.customer_id] || d > lastVisitMap[v.customer_id]) lastVisitMap[v.customer_id] = d
  })
  const overdueList = (customers||[]).filter(cu => {
    if (!cu.is_active || !cu.visit_interval_days) return false
    const last = lastVisitMap[cu.id]
    const days = last ? Math.floor((Date.now()-new Date(last))/86400000) : 999
    return days > cu.visit_interval_days
  }).map(cu => {
    const last = lastVisitMap[cu.id]
    const days = last ? Math.floor((Date.now()-new Date(last))/86400000) : null
    const rep = repMap[cu.assigned_rep_id]
    return { ...cu, daysAgo: days, overBy: days ? days - cu.visit_interval_days : null, repName: rep?.name||'未指派' }
  }).sort((a,b) => (b.overBy||999)-(a.overBy||999)).slice(0,15)

  // 超過30天未交易客戶（從 sales_order）
  const noTradeCusts = (customers||[]).filter(cu => {
    if (!cu.is_active) return false
    const ord = ordersByName[cu.name]
    if (!ord) return true // 近90天完全無資料
    const last = ord.lastDate
    if (!last) return true
    return last < day30ago
  }).map(cu => {
    const ord = ordersByName[cu.name]
    const last = ord?.lastDate
    const days = last ? Math.floor((Date.now()-new Date(last))/86400000) : null
    const rep = repMap[cu.assigned_rep_id]
    return { ...cu, lastOrderDate: last, daysSince: days, repName: rep?.name||'未指派' }
  }).sort((a,b) => (b.daysSince||999)-(a.daysSince||999)).slice(0,20)

  // 交易金額下降客戶（上月有交易、本月明顯下降）
  const decliningCusts = (customers||[]).filter(cu => {
    if (!cu.is_active) return false
    const ord = ordersByName[cu.name]
    if (!ord || !ord.lastMonth || ord.lastMonth < 5000) return false // 上月太小不算
    const dropPct = (ord.lastMonth - ord.thisMonth) / ord.lastMonth
    return dropPct > 0.3 // 下降超過30%
  }).map(cu => {
    const ord = ordersByName[cu.name]
    const dropPct = Math.round((ord.lastMonth - ord.thisMonth) / ord.lastMonth * 100)
    const rep = repMap[cu.assigned_rep_id]
    return { ...cu, thisMonth: ord.thisMonth, lastMonth: ord.lastMonth, dropPct, repName: rep?.name||'未指派' }
  }).sort((a,b) => b.dropPct - a.dropPct).slice(0,15)

  // ── HTML 輸出 ──
  let html = ''

  // 資料管理卡片
  html += `<div class="sec-label">資料管理</div>
  <div class="card" style="margin-bottom:4px">
    <div class="card-top">
      <div style="flex:1"><div class="card-name">銷售資料 (SE11)</div><div class="card-sub" id="mgr-sales-meta">載入中...</div></div>
      <span class="badge b-info" id="mgr-sales-badge">—</span>
    </div>
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn-primary" style="font-size:13px;flex:1;position:relative;overflow:hidden">
        <i class="ti ti-upload"></i> 上傳 SE11
        <input type="file" accept=".xlsx,.xls" style="position:absolute;inset:0;opacity:0;cursor:pointer" onchange="mgrUploadSales(this)">
      </button>
      <button class="btn-ghost" style="font-size:13px" onclick="mgrClearSales()">清除資料</button>
    </div>
    <div id="mgr-upload-log" style="display:none;margin-top:8px;font-size:11px;color:#65655C;background:#f5f4f0;border-radius:6px;padding:8px;max-height:60px;overflow-y:auto;font-family:monospace"></div>
  </div>`

  // 今日狀況
  html += `<div class="sec-label" style="margin-top:20px">今日狀況（${todayStr}）</div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px">
    <div class="metric-card"><div class="mc-label">今日出勤</div><div class="mc-val">${todayOutCount}<span>/${statsArr.length}</span></div></div>
    <div class="metric-card"><div class="mc-label">本月拜訪</div><div class="mc-val">${totalVisits}<span> 次</span></div></div>
    <div class="metric-card"><div class="mc-label">本月成交</div><div class="mc-val">${totalClosed}<span> 筆</span></div></div>
  </div>`
  html += statsArr.map((s,i) => `
    <div class="card" style="display:flex;align-items:center;gap:12px;padding:10px 14px">
      <div class="avatar ${avatarColors(i)}">${initials(s.name)}</div>
      <div style="flex:1"><div class="card-name">${s.name}</div>
        <div class="card-sub">本月拜訪 ${s.visits} 次 · 成交 ${s.closed} 筆</div>
      </div>
      <span class="badge ${s.todayOut?'b-success':'b-gray'}">${s.todayOut?'已出勤':'未出勤'}</span>
    </div>`).join('')

  // 本月拜訪彙整
  html += `<div class="sec-label" style="margin-top:20px">本月拜訪彙整（${period}）</div>`
  html += statsArr.map((s,i) => {
    const closeRate = s.visits ? Math.round(s.closed/s.visits*100) : 0
    const noteRate = s.visits ? Math.round(s.notesFilled/s.visits*100) : 0
    return `<div class="card">
      <div class="card-top">
        <div class="avatar ${avatarColors(i)}">${initials(s.name)}</div>
        <div style="flex:1">
          <div class="card-name">${s.name}</div>
          <div class="card-sub">拜訪 ${s.visits} · 成交 ${s.closed} · 成交率 ${closeRate}% · 備註 ${noteRate}%</div>
        </div>
      </div>
      <div class="prog-bar" style="margin-top:8px">
        <div class="prog-fill" style="width:${closeRate}%;background:${closeRate>=60?'#3B6D11':'#185FA5'}"></div>
      </div>
    </div>`
  }).join('')

  // 未交易客戶（>30天）
  if (noTradeCusts.length) {
    html += `<div class="sec-label" style="margin-top:20px">超過30天未交易（${noTradeCusts.length} 家）</div>`
    html += noTradeCusts.map(cu => `
      <div class="card" style="display:flex;align-items:center;gap:12px;padding:10px 14px">
        <div class="avatar av-amber">${initials(cu.name)}</div>
        <div style="flex:1">
          <div class="card-name">${cu.name}</div>
          <div class="card-sub">${cu.repName} · ${cu.lastOrderDate ? '最後交易 '+cu.lastOrderDate : '近90天無交易'}</div>
        </div>
        <span class="badge ${(cu.daysSince||99)>60?'b-danger':'b-warn'}">${cu.daysSince?cu.daysSince+'天':'90天+'}</span>
      </div>`).join('')
  }

  // 金額下降客戶
  if (decliningCusts.length) {
    html += `<div class="sec-label" style="margin-top:20px">交易金額下降（${prevPeriod} → ${period}）</div>`
    html += decliningCusts.map(cu => `
      <div class="card">
        <div class="card-top">
          <div class="avatar av-red">${initials(cu.name)}</div>
          <div style="flex:1">
            <div class="card-name">${cu.name}</div>
            <div class="card-sub">${cu.repName} · 上月 NT$${Math.round(cu.lastMonth).toLocaleString()} → 本月 NT$${Math.round(cu.thisMonth).toLocaleString()}</div>
          </div>
          <span class="badge b-danger">↓${cu.dropPct}%</span>
        </div>
      </div>`).join('')
  }

  // 久未拜訪警示
  if (overdueList.length) {
    html += `<div class="sec-label" style="margin-top:20px">久未拜訪警示（${overdueList.length} 家）</div>`
    html += overdueList.map(cu => `
      <div class="card" style="display:flex;align-items:center;gap:12px;padding:10px 14px">
        <div class="avatar av-red">${initials(cu.name)}</div>
        <div style="flex:1">
          <div class="card-name">${cu.name}</div>
          <div class="card-sub">${cu.repName} · 週期 ${cu.visit_interval_days} 天</div>
        </div>
        <span class="badge b-danger">逾期 ${cu.overBy??'?'} 天</span>
      </div>`).join('')
  }

  // 待跟進未處理
  if (pendingFollowups?.length) {
    html += `<div class="sec-label" style="margin-top:20px">待跟進未處理（${pendingFollowups.length} 筆）</div>`
    html += pendingFollowups.map((v,i) => `
      <div class="card">
        <div class="card-top">
          <div class="avatar ${avatarColors(i)}">${initials(v.customer?.name)}</div>
          <div style="flex:1">
            <div class="card-name">${v.customer?.name||'—'}</div>
            <div class="card-sub">${v.daily_route?.route_date||''} · ${v.daily_route?.rep_id ? (repMap[v.daily_route.rep_id]?.name||'') : ''}</div>
          </div>
          <button class="btn-ghost" style="font-size:12px" onclick="markFollowUpDone('${v.id}')">完成</button>
        </div>
        ${v.notes?`<div class="card-note">${v.notes}</div>`:''}
      </div>`).join('')
  }

  // 地址差異審核
  if (addrPending?.length) {
    html += `<div class="sec-label" style="margin-top:20px">地址差異待審核（${addrPending.length}）</div>`
    html += addrPending.map(log=>`
      <div class="card">
        <div class="card-top">
          <div class="avatar av-amber">${initials(log.customer?.name)}</div>
          <div style="flex:1"><div class="card-name">${log.customer?.name}</div><div class="card-sub">由 ${log.sales_rep?.name} 提報</div></div>
          <span class="badge b-warn">待審核</span>
        </div>
        <div class="card-note">舊：${log.old_address||'—'}<br>新：${log.new_address}</div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn-primary" style="font-size:13px;padding:8px" onclick="approveAddr('${log.id}')">確認更新</button>
          <button class="btn-outline" onclick="rejectAddr('${log.id}')">退回</button>
        </div>
      </div>`).join('')
  }

  c.innerHTML = html

  // 更新資料管理卡片狀態（從 Supabase 讀實際筆數）
  sb.from('sales_order').select('*', {count:'exact',head:true}).then(({count, error}) => {
    try {
      const metaEl = document.getElementById('mgr-sales-meta')
      const badgeEl = document.getElementById('mgr-sales-badge')
      if (!metaEl || !badgeEl) return
      if (error || count === null) {
        metaEl.textContent = '無法取得筆數'
        badgeEl.textContent = '?'
        badgeEl.className = 'badge b-gray'
      } else {
        // 取最新的訂單日期
        sb.from('sales_order').select('order_date').order('order_date',{ascending:false}).limit(1).single()
          .then(({data:latest}) => {
            const dateRange = latest?.order_date ? ' · 最新 ' + latest.order_date : ''
            metaEl.textContent = count.toLocaleString() + ' 筆' + dateRange
          })
        badgeEl.textContent = '已上傳'
        badgeEl.className = 'badge b-success'
      }
    } catch(e) {}
  })
}

// 管理後台上傳銷售檔
window.mgrUploadSales = async (inp) => {
  const file = inp.files[0]; if (!file) return
  const logEl = document.getElementById('mgr-upload-log')
  logEl.style.display = 'block'
  const addLog = (msg) => { logEl.textContent += msg + '\n'; logEl.scrollTop = logEl.scrollHeight }
  addLog('讀取 ' + file.name + '...')

  // 動態載入 XLSX（CRM 沒有預載）
  if (!window.XLSX) {
    addLog('載入 XLSX 函式庫...')
    await new Promise(res => {
      const s = document.createElement('script')
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
      s.onload = res; document.head.appendChild(s)
    })
  }

  const parsed = await new Promise(res => {
    const fr = new FileReader()
    fr.onload = e => {
      const wb = XLSX.read(e.target.result, {type:'binary',raw:false})
      const sn = wb.SheetNames.find(n => n.includes('銷售') || n==='銷售')
      if (!sn) { addLog('⚠ 找不到銷售工作表'); res([]); return }
      const data = XLSX.utils.sheet_to_json(wb.Sheets[sn], {defval:null,raw:false})
      res(data)
    }
    fr.readAsBinaryString(file)
  })

  if (!parsed.length) { addLog('⚠ 無資料'); inp.value=''; return }
  addLog('解析完成：' + parsed.length + ' 筆，上傳中...')

  // 簡單 mapping（欄位對應 sales_order）
  const CH_REMAP = {'嬰兒房':'嬰藥','藥局':'嬰藥','藥局/嬰兒房':'嬰藥','機關福利社':'嬰藥','安養院':'安養&醫材','醫院':'安養&醫材','醫院/安養院':'安養&醫材','醫療器材行':'安養&醫材','盤商':'盤商(經銷商)','經銷商':'盤商(經銷商)'}
  const seenCtr = {}
  const rows = parsed.map(r => {
    const dateStr = String(r['日期']||'').trim()
    const parts = dateStr.split('/')
    if (parts.length!==3) return null
    const y=parseInt(parts[0])+1911, mo=parseInt(parts[1]), day=parseInt(parts[2])
    const t = String(r['單別']||'').trim()
    const orderNo = String(r['出貨單號']||'').trim()
    let seq
    if (r['序號']!=null&&r['序號']!=='') seq=String(Math.round(parseFloat(r['序號'])||0))
    else { const ck=t+'_'+orderNo; seenCtr[ck]=(seenCtr[ck]||0)+1; seq=String(seenCtr[ck]) }
    const rawCh = String(r['客戶分類']||'').trim()
    const rawReg = String(r['區域分類']||'').trim()
    const ch = CH_REMAP[rawCh]||(rawCh.includes('網')||rawCh.includes('電商')?'網路':rawCh)
    const PE_MAP = {'網路通路-1區':'雅蘋','網路通路-2區':'張蓒'}
    const pe = PE_MAP[rawReg]||String(r['業務姓名']||'').trim()
    return {
      id: t+'_'+orderNo+'_'+seq, order_type:t,
      year:y, month:mo, day:day,
      order_date: y+'-'+String(mo).padStart(2,'0')+'-'+String(day).padStart(2,'0'),
      sales_rep:pe, amount:parseFloat(String(r['未稅金額']||'0').replace(/,/g,''))||0,
      series:String(r['系列']||'').trim(), category:String(r['分類']||'').trim(),
      material:String(r['材質']||'').trim(), raw_material:String(r['材質']||'').trim(),
      channel:ch, raw_channel:rawCh, region:rawReg,
      quantity:parseFloat(String(r['數量']||'0').replace(/,/g,''))||0,
      customer_name:String(r['客戶全稱']||'').trim()||null
    }
  }).filter(Boolean)

  // 分批 upsert
  const CHUNK=200; let done=0, errors=0
  for (let i=0; i<rows.length; i+=CHUNK) {
    const batch = rows.slice(i,i+CHUNK)
    const { error } = await sb.from('sales_order').upsert(batch, {onConflict:'id'})
    if (error) { errors+=batch.length; addLog('⚠ 批次'+(i)+': '+error.message.slice(0,80)) }
    else done+=batch.length
    document.getElementById('mgr-upload-log').textContent = document.getElementById('mgr-upload-log').textContent.replace(/上傳中.*/, '上傳中... '+done+'/'+rows.length)
  }

  addLog(errors===0 ? '✅ 上傳完成：'+done+' 筆' : '⚠ 完成：成功'+done+'，失敗'+errors)
  try {
    const sm = JSON.parse(localStorage.getItem('sd_smeta')||'{}')
    sm[file.name] = {rows:done, date:new Date().toLocaleDateString('zh-TW')}
    localStorage.setItem('sd_smeta', JSON.stringify(sm))
    localStorage.removeItem('sd_sb_date')
  } catch(e) {}
  inp.value=''
  renderManagerOverview()
}

window.mgrClearSales = () => {
  if (!confirm('確定清除本機銷售快取？（Supabase 資料不受影響）')) return
  localStorage.removeItem('sd_sales')
  localStorage.removeItem('sd_smeta')
  localStorage.removeItem('sd_sb_date')
  renderManagerOverview()
}
window.approveAddr = async (id) => {
  const { data: log } = await sb.from('address_change_log').select('*').eq('id',id).single()
  if (!log) return
  await sb.from('customer').update({actual_address:log.new_address,lat:log.new_lat,lng:log.new_lng,address_mismatch:false,address_updated_at:new Date().toISOString()}).eq('id',log.customer_id)
  await sb.from('address_change_log').update({status:'approved',reviewed_by:currentRep?.id,reviewed_at:new Date().toISOString()}).eq('id',id)
  renderManagerOverview()
}

window.rejectAddr = async (id) => {
  const { data: log } = await sb.from('address_change_log').select('customer_id').eq('id',id).single()
  await sb.from('address_change_log').update({status:'rejected'}).eq('id',id)
  if (log?.customer_id) await sb.from('customer').update({address_mismatch:false}).eq('id',log.customer_id)
  renderManagerOverview()
}

window.openVisitModal = async () => {
  const sel = document.getElementById('visit-customer')
  sel.innerHTML = '<option>載入中...</option>'
  document.getElementById('modal-visit').classList.add('open')
  const { data: customers } = await sb.from('customer').select('id,name').eq('is_active',true).order('name')
  sel.innerHTML = customers?.map(c=>`<option value="${c.id}">${c.name}</option>`).join('')||''
  document.querySelectorAll('#visit-result-pills .pill').forEach(p => {
    p.onclick = () => {
      document.querySelectorAll('#visit-result-pills .pill').forEach(x=>x.classList.remove('selected'))
      p.classList.add('selected')
      visitResult = p.dataset.val
      document.getElementById('amount-group').style.display = visitResult==='成交'?'flex':'none'
    }
  })
  document.querySelectorAll('#visit-result-pills .pill')[0].click()
}

window.closeVisitModal = (e) => {
  if (e.target===document.getElementById('modal-visit')) document.getElementById('modal-visit').classList.remove('open')
}

window.submitVisit = async () => {
  const customerId = document.getElementById('visit-customer').value
  const amount = parseInt(document.getElementById('visit-amount').value)||0
  const notes = document.getElementById('visit-notes').value.trim()
  if (!todayRoute || !customerId) return

  const { data: existing } = await sb.from('visit_log').select('id').eq('route_id',todayRoute.id)
  const order = (existing?.length||0) + 1

  const { error } = await sb.from('visit_log').insert({
    route_id: todayRoute.id, customer_id: customerId,
    visit_order: order, result: visitResult,
    amount: visitResult==='成交'?amount:0,
    notes: notes||null,
    follow_up_status: visitResult==='待跟進'?'pending':'none',
    visited_at: new Date().toISOString()
  })

  if (error) { alert('儲存失敗：'+error.message); return }

  document.getElementById('modal-visit').classList.remove('open')
  document.getElementById('visit-amount').value = ''
  document.getElementById('visit-notes').value = ''
  renderToday()
}

document.getElementById('login-password').addEventListener('keydown', e => {
  if (e.key==='Enter') handleLogin()
})

// 頁面載入時檢查是否已登入
sb.auth.getSession().then(async ({ data: { session } }) => {
  if (session?.user) {
    const { data: rep } = await sb.from('sales_rep').select('*').eq('auth_user_id',session.user.id).maybeSingle()
    if (rep) { currentUser = session.user; currentRep = rep; enterApp() }
  }
})
