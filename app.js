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
  const now = new Date()
  const prevDate = new Date(now.getFullYear(), now.getMonth()-1, 1)
  const prevPeriod = prevDate.toISOString().slice(0,7)
  const prev2Date = new Date(now.getFullYear(), now.getMonth()-2, 1)
  const prev2Period = prev2Date.toISOString().slice(0,7)
  const day180ago = new Date(Date.now()-180*86400000).toISOString().slice(0,10)
  const day90ago  = new Date(Date.now()-90*86400000).toISOString().slice(0,10)
  const day30ago  = new Date(Date.now()-30*86400000).toISOString().slice(0,10)

  const [
    { data: reps },
    { data: allRoutes },
    { data: allVisits },
    { data: customers },
    { data: addrPending },
    { data: pendingFollowups },
    { data: recentOrders },
    { data: allVisitedIds }
  ] = await Promise.all([
    sb.from('sales_rep').select('id,name,role').in('role',['sales','manager']).in('name',ACTIVE_REPS).order('name'),
    sb.from('daily_route').select('id,rep_id,route_date').gte('route_date', monthStart),
    sb.from('visit_log').select('id,route_id,result,amount,notes,visited_at,follow_up_status,customer_id,customer(name)')
      .gte('visited_at', monthStart+'T00:00:00'),
    sb.from('customer').select('id,name,assigned_rep_id,visit_interval_days,is_active,type,grade'),
    sb.from('address_change_log').select('*, customer(name), sales_rep(name)').eq('status','pending'),
    sb.from('visit_log').select('id,route_id,customer_id,notes,visited_at,customer(name),daily_route(route_date,rep_id)')
      .eq('result','待跟進').eq('follow_up_status','pending'),
    sb.from('sales_order').select('customer_name,amount,year,month,day,order_date')
      .eq('order_type','出貨').gt('amount',0).gte('order_date', day180ago),
    // 近180天有被拜訪過的 customer_id
    sb.from('visit_log').select('customer_id').gte('visited_at', day180ago+'T00:00:00')
  ])

  // ── 輔助 map ──
  const routeRepMap = {}
  ;(allRoutes||[]).forEach(r => { routeRepMap[r.id] = r.rep_id })
  const todayRouteRepIds = new Set((allRoutes||[]).filter(r=>r.route_date===todayStr).map(r=>r.rep_id))
  const repMap = {}
  ;(reps||[]).forEach(r => { repMap[r.id] = r })
  const activeRepIds = new Set(Object.values(repMap).filter(r=>ACTIVE_REPS.includes(r.name)).map(r=>r.id))
  const visitedCustIds = new Set((allVisitedIds||[]).map(v=>v.customer_id))

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
  const ordersByName = {}
  const lastOrderMap = {}  // customer_name -> 最後交易日
  ;(recentOrders||[]).forEach(o => {
    const k = o.customer_name; if (!k) return
    if (!ordersByName[k]) ordersByName[k] = { thisMonth:0, lastMonth:0, lastDate:null }
    const ym = String(o.year)+'-'+String(o.month).padStart(2,'0')
    if (ym === prevPeriod)  ordersByName[k].thisMonth += o.amount
    if (ym === prev2Period) ordersByName[k].lastMonth += o.amount
    const d = o.order_date?.slice(0,10)
    if (d && (!ordersByName[k].lastDate || d > ordersByName[k].lastDate)) ordersByName[k].lastDate = d
    if (d && (!lastOrderMap[k] || d > lastOrderMap[k])) lastOrderMap[k] = d
  })

  // 只處理三位業務的客戶
  const activeCusts = (customers||[]).filter(cu =>
    cu.is_active && cu.assigned_rep_id && activeRepIds.has(cu.assigned_rep_id)
  )

  // ABC 等級顏色
  function gradeStyle(grade) {
    if (grade==='A') return 'border-left:3px solid #C8A93B;'
    if (grade==='B') return 'border-left:3px solid #6B9FD4;'
    if (grade==='C') return 'border-left:3px solid #A0A0A0;'
    return ''
  }
  function gradeBadge(grade) {
    if (grade==='A') return '<span style="font-size:10px;font-weight:700;color:#C8A93B;background:#FDF6DC;border-radius:3px;padding:1px 5px">A</span>'
    if (grade==='B') return '<span style="font-size:10px;font-weight:700;color:#2C6FAC;background:#E8F1FA;border-radius:3px;padding:1px 5px">B</span>'
    if (grade==='C') return '<span style="font-size:10px;font-weight:700;color:#888;background:#F0F0F0;border-radius:3px;padding:1px 5px">C</span>'
    return ''
  }

  // 未拜訪客戶：近半年有交易但從未被拜訪
  const unvisitedCusts = activeCusts.filter(cu => {
    const hasOrder = !!lastOrderMap[cu.name]
    const wasVisited = visitedCustIds.has(cu.id)
    return hasOrder && !wasVisited
  }).map(cu => {
    const rep = repMap[cu.assigned_rep_id]
    return { ...cu, lastOrderDate: lastOrderMap[cu.name], repName: rep?.name||'未指派' }
  }).sort((a,b) => {
    const ga = a.grade||'Z', gb = b.grade||'Z'
    if (ga!==gb) return ga.localeCompare(gb)
    return (b.lastOrderDate||'').localeCompare(a.lastOrderDate||'')
  })

  // 超過30天未交易
  const noTradeCusts = activeCusts.filter(cu => {
    const last = lastOrderMap[cu.name]
    if (!last) return false  // 近180天完全無交易不在這裡
    return last < day30ago
  }).map(cu => {
    const last = lastOrderMap[cu.name]
    const days = Math.floor((Date.now()-new Date(last))/86400000)
    const rep = repMap[cu.assigned_rep_id]
    return { ...cu, lastOrderDate: last, daysSince: days, repName: rep?.name||'未指派' }
  }).sort((a,b) => {
    const ga = a.grade||'Z', gb = b.grade||'Z'
    if (ga!==gb) return ga.localeCompare(gb)
    return b.daysSince - a.daysSince
  })

  // 金額下降
  const decliningCusts = activeCusts.filter(cu => {
    const ord = ordersByName[cu.name]
    if (!ord || !ord.lastMonth || ord.lastMonth < 5000) return false
    return (ord.lastMonth - ord.thisMonth) / ord.lastMonth > 0.3
  }).map(cu => {
    const ord = ordersByName[cu.name]
    const dropPct = Math.round((ord.lastMonth - ord.thisMonth) / ord.lastMonth * 100)
    const rep = repMap[cu.assigned_rep_id]
    return { ...cu, thisMonth: ord.thisMonth, lastMonth: ord.lastMonth, dropPct, repName: rep?.name||'未指派' }
  }).sort((a,b) => {
    const ga = a.grade||'Z', gb = b.grade||'Z'
    if (ga!==gb) return ga.localeCompare(gb)
    return b.dropPct - a.dropPct
  })

  // 久未拜訪（超過 visit_interval_days）
  const lastVisitMap = {}
  const { data: hist90 } = await sb.from('visit_log').select('customer_id,visited_at')
    .gte('visited_at', day90ago+'T00:00:00')
  ;(hist90||[]).forEach(v => {
    const d = v.visited_at?.slice(0,10)
    if (!d) return
    if (!lastVisitMap[v.customer_id] || d > lastVisitMap[v.customer_id]) lastVisitMap[v.customer_id] = d
  })
  const overdueList = activeCusts.filter(cu => {
    if (!cu.visit_interval_days) return false
    const last = lastVisitMap[cu.id]
    const days = last ? Math.floor((Date.now()-new Date(last))/86400000) : 999
    return days > cu.visit_interval_days
  }).map(cu => {
    const last = lastVisitMap[cu.id]
    const days = last ? Math.floor((Date.now()-new Date(last))/86400000) : null
    const rep = repMap[cu.assigned_rep_id]
    return { ...cu, daysAgo: days, overBy: days ? days - cu.visit_interval_days : null, repName: rep?.name||'未指派' }
  }).sort((a,b) => {
    const ga = a.grade||'Z', gb = b.grade||'Z'
    if (ga!==gb) return ga.localeCompare(gb)
    return (b.overBy||0)-(a.overBy||0)
  })

  // ── 渲染客戶卡片（含 ABC 顏色、展開更多）──
  function renderCustList(list, emptyMsg) {
    if (!list.length) return `<div class="empty-state" style="padding:20px 0">${emptyMsg}</div>`
    const PREVIEW = 10
    const shown = list.slice(0, PREVIEW)
    const rest = list.slice(PREVIEW)
    let h = shown.map(cu => `
      <div class="card" style="display:flex;align-items:center;gap:12px;padding:10px 14px;${gradeStyle(cu.grade)}">
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:6px">
            <div class="card-name">${cu.name}</div>
            ${gradeBadge(cu.grade)}
          </div>
          <div class="card-sub">${cu.repName}${cu.lastOrderDate?' · 最後交易 '+cu.lastOrderDate:''}${cu.daysSince?' · '+cu.daysSince+'天未交易':''}${cu.overBy?' · 逾期 '+cu.overBy+'天':''}${cu.dropPct?' · ↓'+cu.dropPct+'%':''}</div>
        </div>
        ${cu.daysSince>60||cu.overBy>30?'<span class="badge b-danger">需關注</span>':cu.daysSince>30||cu.overBy>0?'<span class="badge b-warn">注意</span>':''}
      </div>`).join('')
    if (rest.length) {
      const restId = 'more-'+Math.random().toString(36).slice(2,8)
      h += `<div id="${restId}" style="display:none">`
      h += rest.map(cu => `
        <div class="card" style="display:flex;align-items:center;gap:12px;padding:10px 14px;${gradeStyle(cu.grade)}">
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:6px">
              <div class="card-name">${cu.name}</div>
              ${gradeBadge(cu.grade)}
            </div>
            <div class="card-sub">${cu.repName}${cu.lastOrderDate?' · 最後交易 '+cu.lastOrderDate:''}${cu.daysSince?' · '+cu.daysSince+'天未交易':''}${cu.overBy?' · 逾期 '+cu.overBy+'天':''}${cu.dropPct?' · ↓'+cu.dropPct+'%':''}</div>
          </div>
          ${cu.daysSince>60||cu.overBy>30?'<span class="badge b-danger">需關注</span>':cu.daysSince>30||cu.overBy>0?'<span class="badge b-warn">注意</span>':''}
        </div>`).join('')
      h += `</div>`
      h += `<button class="btn-ghost" style="width:100%;margin-top:6px;font-size:12px" 
              onclick="const el=document.getElementById('${restId}');const btn=this;if(el.style.display==='none'){el.style.display='';btn.textContent='收起 ▲'}else{el.style.display='none';btn.textContent='查看更多 ${rest.length} 家 ▼'}">
              查看更多 ${rest.length} 家 ▼</button>`
    }
    return h
  }

  // ── Tab 架構 ──
  const tabs = [
    { id:'tab-overview', label:'今日概況' },
    { id:'tab-unvisited', label:`未拜訪 ${unvisitedCusts.length}` },
    { id:'tab-notrade',  label:`未交易 ${noTradeCusts.length}` },
    { id:'tab-decline',  label:`金額下降 ${decliningCusts.length}` },
    { id:'tab-overdue',  label:`久未拜訪 ${overdueList.length}` },
    { id:'tab-pending',  label:`待跟進 ${pendingFollowups?.length||0}` },
    { id:'tab-addr',     label:`地址審核 ${addrPending?.length||0}` },
    { id:'tab-data',     label:'資料管理' },
  ]

  let html = `
  <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;margin:-8px -16px 12px;padding:0 16px">
    <div style="display:flex;gap:4px;border-bottom:1px solid #e8e6e0;min-width:max-content">
      ${tabs.map((t,i)=>`<button id="${t.id}-btn" onclick="mgrTab('${t.id}')" style="font-size:12px;padding:8px 12px;background:none;border:none;border-bottom:2px solid ${i===0?'#1A472A':'transparent'};color:${i===0?'#1A472A':'#65655C'};cursor:pointer;white-space:nowrap;font-family:inherit">${t.label}</button>`).join('')}
    </div>
  </div>
  `

  // Tab 內容
  html += `<div id="tab-overview">`
  html += `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px">
    <div class="metric-card"><div class="mc-label">今日出勤</div><div class="mc-val">${todayOutCount}<span>/${statsArr.length}</span></div></div>
    <div class="metric-card"><div class="mc-label">本月拜訪</div><div class="mc-val">${totalVisits}<span> 次</span></div></div>
    <div class="metric-card"><div class="mc-label">本月成交</div><div class="mc-val">${totalClosed}<span> 筆</span></div></div>
  </div>`
  html += statsArr.map((s,i) => `
    <div class="card">
      <div class="card-top">
        <div class="avatar ${avatarColors(i)}">${initials(s.name)}</div>
        <div style="flex:1">
          <div class="card-name">${s.name}</div>
          <div class="card-sub">拜訪 ${s.visits} · 成交 ${s.closed} · ${s.visits?Math.round(s.closed/s.visits*100):0}% 成交率 · 備註 ${s.visits?Math.round(s.notesFilled/s.visits*100):0}%</div>
        </div>
        <span class="badge ${s.todayOut?'b-success':'b-gray'}">${s.todayOut?'已出勤':'未出勤'}</span>
      </div>
      <div class="prog-bar" style="margin-top:8px">
        <div class="prog-fill" style="width:${s.visits?Math.round(s.closed/s.visits*100):0}%;background:#185FA5"></div>
      </div>
    </div>`).join('')
  html += `</div>`

  html += `<div id="tab-unvisited" style="display:none">
    <div class="sec-label">近半年有交易但尚未拜訪（${unvisitedCusts.length} 家）</div>
    ${renderCustList(unvisitedCusts, '無未拜訪客戶')}
  </div>`

  html += `<div id="tab-notrade" style="display:none">
    <div class="sec-label">超過30天未交易（${noTradeCusts.length} 家）</div>
    ${renderCustList(noTradeCusts, '無未交易客戶')}
  </div>`

  html += `<div id="tab-decline" style="display:none">
    <div class="sec-label">交易金額下降 &gt;30%（${prev2Period} → ${prevPeriod}）共 ${decliningCusts.length} 家</div>
    ${renderCustList(decliningCusts, '無明顯下降客戶')}
  </div>`

  html += `<div id="tab-overdue" style="display:none">
    <div class="sec-label">久未拜訪（超過週期設定）共 ${overdueList.length} 家</div>
    ${renderCustList(overdueList, '無逾期未拜訪客戶')}
  </div>`

  html += `<div id="tab-pending" style="display:none">`
  if (pendingFollowups?.length) {
    html += pendingFollowups.map((v,i) => `
      <div class="card">
        <div class="card-top">
          <div class="avatar ${avatarColors(i)}">${initials(v.customer?.name)}</div>
          <div style="flex:1">
            <div class="card-name">${v.customer?.name||'—'}</div>
            <div class="card-sub">${v.daily_route?.route_date||''} · ${v.daily_route?.rep_id?(repMap[v.daily_route.rep_id]?.name||''):''}</div>
          </div>
          <button class="btn-ghost" style="font-size:12px" onclick="markFollowUpDone('${v.id}')">完成</button>
        </div>
        ${v.notes?`<div class="card-note">${v.notes}</div>`:''}
      </div>`).join('')
  } else {
    html += '<div class="empty-state" style="padding:20px 0">無待跟進事項</div>'
  }
  html += `</div>`

  html += `<div id="tab-addr" style="display:none">`
  if (addrPending?.length) {
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
  } else {
    html += '<div class="empty-state" style="padding:20px 0">無待審核地址</div>'
  }
  html += `</div>`

  html += `<div id="tab-data" style="display:none">
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
  </div></div>`

  c.innerHTML = html

  // Tab 切換函數
  window.mgrTab = (activeId) => {
    tabs.forEach(t => {
      const el = document.getElementById(t.id)
      const btn = document.getElementById(t.id+'-btn')
      if (!el || !btn) return
      const isActive = t.id === activeId
      el.style.display = isActive ? '' : 'none'
      btn.style.borderBottomColor = isActive ? '#1A472A' : 'transparent'
      btn.style.color = isActive ? '#1A472A' : '#65655C'
    })
  }

  // 讀 Supabase 實際筆數（資料管理 tab）
  sb.from('sales_order').select('*',{count:'exact',head:true}).then(({count,error})=>{
    const metaEl = document.getElementById('mgr-sales-meta')
    const badgeEl = document.getElementById('mgr-sales-badge')
    if (!metaEl||!badgeEl) return
    if (error||count===null) { metaEl.textContent='無法取得筆數'; return }
    sb.from('sales_order').select('order_date').order('order_date',{ascending:false}).limit(1).single()
      .then(({data:latest})=>{
        metaEl.textContent = count.toLocaleString()+' 筆'+(latest?.order_date?' · 最新 '+latest.order_date:'')
        badgeEl.textContent='已上傳'; badgeEl.className='badge b-success'
      })
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
