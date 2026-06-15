import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = 'https://trxmfvosyfnlidmyelzs.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyeG1mdm9zeWZubGlkbXllbHpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyMTU5NDUsImV4cCI6MjA5Mzc5MTk0NX0.auFOS6ZtcmhsXMWBctFtRr-KnKmGDh4E5jhnk79Vbx0'
const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

const GMAPS_KEY = 'AIzaSyCb21ymiEnQmzvTAXE_mS_cvVQ__dIQ9Zc'
const COMPANY_ADDRESS = '台中市西屯區廣福路150巷25號'
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
  // 問候語：放在 top-title
  if (currentRep?.name) {
    const titleEl = document.getElementById('top-title')
    if (titleEl) titleEl.textContent = '您好，' + currentRep.name
  }
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
  const titleEl = document.getElementById('top-title')
  const pageTitles = {customers:'我的客戶',pending:'待辦清單',stats:'我的數字',history:'拜訪歷史'}
  if (page === 'today') {
    const now = new Date()
    const dateStr = (now.getMonth()+1) + '月' + now.getDate() + '日'
    const name = currentRep?.name || ''
    titleEl.innerHTML = `<span style="font-weight:400;font-size:12px;color:#65655C">${dateStr}</span>&nbsp;&nbsp;<span style="font-weight:600">您好，${name}</span>`
  } else {
    titleEl.textContent = pageTitles[page] || page
  }
  if (page==='today') renderToday()
  if (page==='history') renderHistory()
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
      <div class="metric-card">
        <div class="mc-label">今日里程</div>
        <div class="mc-val" id="km-display">${sysKm?sysKm+'<span> km</span>':'<span style="font-size:13px;color:#aaa">未計算</span>'}</div>
        <div class="mc-sub" id="km-sub">${sysKm?'預估油資 NT$'+Math.round(sysKm*4):(todayRoute?.gmaps_km?'業務回報 '+todayRoute.gmaps_km+'km':'')}</div>
        <button class="btn-ghost" style="font-size:11px;margin-top:4px;width:100%" onclick="calcKm()" id="calc-km-btn">
          <i class="ti ti-map-pin-2"></i> 計算今日里程
        </button>
      </div>
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
          <div style="display:flex;gap:8px;margin-top:8px;justify-content:flex-end">
            <button class="btn-ghost" style="font-size:12px;padding:4px 10px" onclick="openEditVisitModal('${v.id}','${(v.customer?.name||'').replace(/'/g,"\'")}','${v.result}',${v.amount||0},'${(v.notes||'').replace(/'/g,"\'")}')">
              <i class="ti ti-edit"></i> 編輯
            </button>
            <button class="btn-ghost" style="font-size:12px;padding:4px 10px;color:var(--rd)" onclick="deleteVisit('${v.id}')">
              <i class="ti ti-trash"></i> 刪除
            </button>
          </div>
        </div>`).join('')}
  `
}

window.renderCustomers = async function() {
  const c = document.getElementById('page-content')
  c.innerHTML = '<div class="loading"><div class="spinner"></div> 載入中</div>'
  let q = sb.from('customer').select('id,name,type,grade,actual_address,erp_address,address_mismatch,visit_interval_days').eq('is_active',true).order('grade').order('name')
  if (currentRep) q = q.eq('assigned_rep_id', currentRep.id)
  const { data: customers } = await q
  if (!customers?.length) { c.innerHTML = '<div class="empty-state"><i class="ti ti-building-store"></i>尚無客戶資料</div>'; return }

  // 拜訪記錄
  const day90ago = new Date(Date.now()-90*86400000).toISOString().slice(0,10)
  const custIds = customers.map(cu=>cu.id)
  const { data: recentVisits } = await sb.from('visit_log')
    .select('customer_id,visited_at').in('customer_id', custIds.slice(0,200))
    .gte('visited_at', day90ago+'T00:00:00').order('visited_at',{ascending:false})
  const lastVisitMap = {}
  ;(recentVisits||[]).forEach(v => { if (!lastVisitMap[v.customer_id]) lastVisitMap[v.customer_id] = v.visited_at?.slice(0,10) })

  // 快取供點擊詳情用
  window._allCustomers = customers

  function gradeTag(g) {
    if (g==='A') return '<span style="font-size:10px;font-weight:700;color:#C8A93B;background:#FDF6DC;border-radius:3px;padding:1px 5px;margin-left:4px">A</span>'
    if (g==='B') return '<span style="font-size:10px;font-weight:700;color:#2C6FAC;background:#E8F1FA;border-radius:3px;padding:1px 5px;margin-left:4px">B</span>'
    if (g==='C') return '<span style="font-size:10px;font-weight:700;color:#888;background:#F0F0F0;border-radius:3px;padding:1px 5px;margin-left:4px">C</span>'
    return ''
  }
  function gradeLeft(g) {
    if (g==='A') return 'border-left:3px solid #C8A93B'
    if (g==='B') return 'border-left:3px solid #6B9FD4'
    return 'border-left:3px solid #C0C0C0'
  }

  const groups = {A:[],B:[],C:[],'others':[]}
  customers.forEach(cu => { (groups[cu.grade]||groups['others']).push(cu) })

  function renderList(list) {
    return list.map(cu => {
      const lastVisit = lastVisitMap[cu.id]
      const urg = visitUrgency(lastVisit, cu.visit_interval_days||21)
      return `<div class="card" style="cursor:pointer;${gradeLeft(cu.grade)}" onclick="openCustomerDetail('${cu.id}')">
        <div class="card-top">
          <div style="flex:1">
            <div style="display:flex;align-items:center"><div class="card-name">${cu.name}</div>${gradeTag(cu.grade)}</div>
            <div class="card-sub">${cu.type||''}</div>
          </div>
          <span class="badge ${urg.cls}">${urg.label}</span>
        </div>
        <div class="card-meta"><span><i class="ti ti-map-pin"></i>${cu.actual_address||cu.erp_address||'地址未設定'}</span></div>
        ${cu.address_mismatch?'<div class="card-note" style="color:#854F0B"><i class="ti ti-alert-triangle"></i> 地址差異待審核</div>':''}
      </div>`
    }).join('')
  }

  const gradeOrder = [{key:'A',label:'A 級'},{key:'B',label:'B 級'},{key:'C',label:'C 級'},{key:'others',label:'未分級'}]

  let listHtml = ''
  gradeOrder.forEach(({key,label}) => {
    const list = groups[key]
    if (!list.length) return
    listHtml += `<div class="grade-section" data-grade="${key}">
      <div style="font-size:11px;font-weight:600;color:#65655C;letter-spacing:.06em;text-transform:uppercase;margin:14px 0 6px">${label}（${list.length}）</div>
      ${renderList(list)}
    </div>`
  })

  c.innerHTML = `
    <div style="position:sticky;top:0;background:#fff;z-index:10;padding:8px 0 6px;border-bottom:1px solid #eee;margin-bottom:8px">
      <input type="text" placeholder="搜尋客戶名稱…" id="cust-search"
        style="width:100%;padding:8px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;outline:none"
        oninput="filterCustList(this.value)">
    </div>
    <div id="cust-list">${listHtml}</div>
  `
}

window.filterCustList = (kw) => {
  const kl = kw.trim().toLowerCase()
  document.querySelectorAll('.grade-section').forEach(sec => {
    let visible = 0
    sec.querySelectorAll('.card').forEach(card => {
      const name = card.querySelector('.card-name')?.textContent?.toLowerCase()||''
      const show = !kl || name.includes(kl)
      card.style.display = show ? '' : 'none'
      if (show) visible++
    })
    sec.style.display = visible ? '' : 'none'
  })
}

window.openCustomerDetail = async (custId) => {
  const cu = (window._allCustomers||[]).find(c=>c.id===custId)
  if (!cu) return
  const c = document.getElementById('page-content')
  c.innerHTML = '<div class="loading"><div class="spinner"></div> 載入中</div>'

  // 近6個月出貨資料
  const day180ago = new Date(Date.now()-180*86400000).toISOString().slice(0,10)
  const { data: orders } = await sb.from('sales_order')
    .select('order_date,amount,series,category,material,order_type')
    .eq('customer_name', cu.name)
    .eq('order_type','出貨').gt('amount',0)
    .gte('order_date', day180ago)
    .order('order_date',{ascending:false})
    .limit(50)

  // 近拜訪記錄
  const { data: visits } = await sb.from('visit_log')
    .select('visited_at,result,amount,notes').eq('customer_id', custId)
    .order('visited_at',{ascending:false}).limit(10)

  const totalAmt = (orders||[]).reduce((s,o)=>s+o.amount,0)
  const byMonth = {}
  ;(orders||[]).forEach(o => {
    const ym = o.order_date?.slice(0,7)
    if (ym) byMonth[ym] = (byMonth[ym]||0) + o.amount
  })

  function gradeTag(g) {
    if (g==='A') return '<span style="font-size:11px;font-weight:700;color:#C8A93B;background:#FDF6DC;border-radius:3px;padding:2px 7px">A</span>'
    if (g==='B') return '<span style="font-size:11px;font-weight:700;color:#2C6FAC;background:#E8F1FA;border-radius:3px;padding:2px 7px">B</span>'
    if (g==='C') return '<span style="font-size:11px;font-weight:700;color:#888;background:#F0F0F0;border-radius:3px;padding:2px 7px">C</span>'
    return ''
  }

  c.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
      <button class="btn-ghost" style="font-size:13px;padding:6px 10px" onclick="renderCustomers()">← 返回</button>
      <div style="flex:1">
        <div style="font-size:16px;font-weight:600;display:flex;align-items:center;gap:6px">${cu.name} ${gradeTag(cu.grade)}</div>
        <div style="font-size:12px;color:#999">${cu.type||''}</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
      <div class="metric-card"><div class="mc-label">近6月交易</div><div class="mc-val" style="font-size:16px">NT$${Math.round(totalAmt/1000)}K</div></div>
      <div class="metric-card"><div class="mc-label">交易筆數</div><div class="mc-val">${(orders||[]).length}<span> 筆</span></div></div>
    </div>

    <div class="sec-label">月別銷售</div>
    ${Object.entries(byMonth).sort((a,b)=>b[0].localeCompare(a[0])).map(([ym,amt])=>`
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:.5px solid #f0ede8">
        <span style="font-size:13px;color:#555">${ym}</span>
        <span style="font-size:13px;font-weight:500">NT$${Math.round(amt).toLocaleString()}</span>
      </div>`).join('')||'<div style="color:#aaa;font-size:13px;padding:12px 0">近6個月無交易記錄</div>'}

    <div class="sec-label" style="margin-top:16px">近期拜訪</div>
    ${!(visits||[]).length?'<div style="color:#aaa;font-size:13px;padding:12px 0">尚無拜訪記錄</div>'
      :(visits||[]).map(v=>`
        <div style="padding:10px 0;border-bottom:.5px solid #f0ede8">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span style="font-size:12px;color:#555">${v.visited_at?.slice(0,10)}</span>
            <span class="badge ${v.result==='成交'?'b-success':v.result==='待跟進'?'b-warn':'b-gray'}" style="font-size:11px">${v.result}</span>
          </div>
          ${v.amount?`<div style="font-size:13px;font-weight:500">NT$${v.amount.toLocaleString()}</div>`:''}
          ${v.notes?`<div style="font-size:12px;color:#777;margin-top:2px">${v.notes}</div>`:''}
        </div>`).join('')}

    <div style="margin-top:16px">
      <div class="sec-label">地址</div>
      <div style="font-size:13px;color:#555">${cu.actual_address||cu.erp_address||'未設定'}</div>
      ${cu.address_mismatch?'<div class="card-note" style="color:#854F0B;margin-top:6px"><i class="ti ti-alert-triangle"></i> 地址差異待審核</div>':''}
    </div>
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
  const monthStart = period + '-01'

  // 平行拉：本月出貨、本月拜訪、里程、配額
  const [
    { data: orders },
    { data: visits },
    { data: routes },
    { data: quota }
  ] = await Promise.all([
    sb.from('sales_order')
      .select('amount,order_date')
      .eq('sales_rep', currentRep.name)
      .eq('order_type','出貨')
      .gt('amount', 0)
      .gte('order_date', monthStart)
      .limit(2000),
    sb.from('visit_log')
      .select('id,result,visited_at,route_id,daily_route(rep_id)')
      .gte('visited_at', monthStart+'T00:00:00'),
    sb.from('daily_route')
      .select('approved_km,system_km,gmaps_km')
      .eq('rep_id', currentRep.id)
      .gte('route_date', monthStart),
    sb.from('quota')
      .select('amount_target,visit_target')
      .eq('rep_id', currentRep.id)
      .eq('period', period)
      .maybeSingle()
  ])

  // 過濾自己的拜訪（透過 route 的 rep_id）
  const myVisits = (visits||[]).filter(v => v.daily_route?.rep_id === currentRep.id)
  const closedVisits = myVisits.filter(v => v.result === '成交')

  const totalAmt = (orders||[]).reduce((s,o)=>s+o.amount,0)
  const totalKm = (routes||[]).reduce((s,r)=>s+(r.approved_km||r.gmaps_km||r.system_km||0),0)

  // 月別業績（近6個月）
  const day180ago = new Date(Date.now()-180*86400000).toISOString().slice(0,10)
  const { data: histOrders } = await sb.from('sales_order')
    .select('amount,year,month')
    .eq('sales_rep', currentRep.name)
    .eq('order_type','出貨')
    .gt('amount',0)
    .gte('order_date', day180ago)
    .limit(5000)

  const byMonth = {}
  ;(histOrders||[]).forEach(o => {
    const ym = String(o.year)+'-'+String(o.month).padStart(2,'0')
    byMonth[ym] = (byMonth[ym]||0) + o.amount
  })

  const amtTarget = quota?.amount_target || 0
  const amtPct = amtTarget > 0 ? Math.min(Math.round(totalAmt/amtTarget*100),100) : null
  const amtColor = amtPct===null?'#185FA5':amtPct>=100?'#3B6D11':amtPct>=80?'#C8612A':'#A32D2D'

  c.innerHTML = `
    <div class="sec-label">本月達成 · ${period}</div>
    <div class="metric-row">
      <div class="metric-card">
        <div class="mc-label">本月業績</div>
        <div class="mc-val" style="font-size:16px">NT$${Math.round(totalAmt/1000)}K</div>
        ${amtTarget?`<div class="mc-sub">目標 NT$${Math.round(amtTarget/1000)}K</div>`:'<div class="mc-sub" style="color:#aaa">未設定配額</div>'}
      </div>
      <div class="metric-card">
        <div class="mc-label">業績達成率</div>
        <div class="mc-val" style="color:${amtColor}">${amtPct!==null?amtPct+'%':'—'}</div>
        ${amtPct!==null?`<div class="mc-sub">${amtPct>=100?'✓ 達標':'差 NT$'+Math.round((amtTarget-totalAmt)/1000)+'K'}</div>`:''}
      </div>
    </div>
    <div class="metric-row">
      <div class="metric-card"><div class="mc-label">本月拜訪</div><div class="mc-val">${myVisits.length}<span> 次</span></div></div>
      <div class="metric-card"><div class="mc-label">成交家數</div><div class="mc-val">${closedVisits.length}<span> 筆</span></div><div class="mc-sub">成交率 ${myVisits.length?Math.round(closedVisits.length/myVisits.length*100):0}%</div></div>
    </div>
    ${amtTarget?`<div class="card" style="margin-bottom:12px">
      <div class="prog-wrap">
        <div class="prog-label"><span>業績進度</span><span>${amtPct}%</span></div>
        <div class="prog-bar"><div class="prog-fill" style="width:${amtPct}%;background:${amtColor}"></div></div>
      </div>
    </div>`:''}
    <div class="metric-row">
      <div class="metric-card"><div class="mc-label">累計里程</div><div class="mc-val">${Math.round(totalKm*10)/10}<span> km</span></div><div class="mc-sub">油資 NT$${Math.round(totalKm*4)}</div></div>
      <div class="metric-card"><div class="mc-label">里程補貼</div><div class="mc-val" style="font-size:16px">NT$${Math.round(totalKm*4).toLocaleString()}</div></div>
    </div>
    <div class="sec-label">近6個月業績</div>
    <div class="card">
      ${Object.entries(byMonth).sort((a,b)=>b[0].localeCompare(a[0])).map(([ym,amt])=>`
        <div class="prog-wrap">
          <div class="prog-label">
            <span>${ym}</span>
            <span>NT$${Math.round(amt/1000)}K</span>
          </div>
          <div class="prog-bar">
            <div class="prog-fill" style="width:${Math.min(Math.round(amt/Math.max(...Object.values(byMonth))*100),100)}%;background:#185FA5"></div>
          </div>
        </div>`).join('')||'<div style="color:#aaa;font-size:13px">尚無資料</div>'}
    </div>
  `
}

async function renderManagerOverview() {
  document.getElementById('top-title').textContent = '管理者後台'
  const c = document.getElementById('page-content')
  c.innerHTML = '<div class="loading"><div class="spinner"></div> 載入中</div>'
  let _mgrTimeout = setTimeout(()=>{ c.innerHTML='<div style="padding:40px;text-align:center;color:#999">載入逾時，請重新整理</div>' }, 120000)

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
    // 近180天有被拜訪過的 customer_id（只拿 id，限制筆數避免 timeout）
    sb.from('visit_log').select('customer_id').gte('visited_at', day180ago+'T00:00:00').limit(5000)
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
    .gte('visited_at', day90ago+'T00:00:00').limit(5000)
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
  function renderDeclineList(list) {
    if (!list.length) return `<div class="empty-state" style="padding:20px 0">無明顯下降客戶</div>`
    const PREVIEW = 10
    const renderItem = cu => {
      const fmtK = n => n >= 1000 ? (n/1000).toFixed(1)+'K' : Math.round(n).toLocaleString()
      const bar = cu.lastMonth > 0 ? Math.min(Math.round(cu.thisMonth/cu.lastMonth*100),100) : 0
      const barColor = cu.dropPct >= 70 ? '#A32D2D' : cu.dropPct >= 50 ? '#C8612A' : '#C8A93B'
      return `<div class="card" style="${gradeStyle(cu.grade)}">
        <div class="card-top" style="margin-bottom:10px">
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
              <div class="card-name">${cu.name}</div>
              ${gradeBadge(cu.grade)}
            </div>
            <div class="card-sub">${cu.repName}</div>
          </div>
          <span class="badge b-danger" style="font-size:13px;font-weight:700">↓${cu.dropPct}%</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          <div style="background:#f5f4f0;border-radius:6px;padding:8px 10px">
            <div style="font-size:10px;color:#9A9A92;margin-bottom:2px">${prev2Period}（前期）</div>
            <div style="font-size:15px;font-weight:600;color:#18180F">NT$${fmtK(cu.lastMonth)}</div>
          </div>
          <div style="background:#f5f4f0;border-radius:6px;padding:8px 10px">
            <div style="font-size:10px;color:#9A9A92;margin-bottom:2px">${prevPeriod}（上月）</div>
            <div style="font-size:15px;font-weight:600;color:${cu.dropPct>=50?'#A32D2D':'#C8612A'}">NT$${fmtK(cu.thisMonth)}</div>
          </div>
        </div>
        <div style="height:6px;background:#e8e6e0;border-radius:3px;overflow:hidden">
          <div style="height:6px;border-radius:3px;background:${barColor};width:${bar}%;transition:width .4s"></div>
        </div>
        <div style="font-size:10px;color:#9A9A92;margin-top:3px;text-align:right">上月僅達前期 ${bar}%</div>
      </div>`
    }
    const shown = list.slice(0,PREVIEW)
    const rest = list.slice(PREVIEW)
    let h = shown.map(renderItem).join('')
    if (rest.length) {
      const restId = 'dec-more-'+Math.random().toString(36).slice(2,8)
      h += `<div id="${restId}" style="display:none">${rest.map(renderItem).join('')}</div>`
      h += `<button class="btn-ghost" style="width:100%;margin-top:6px;font-size:12px"
              onclick="const el=document.getElementById('${restId}');const btn=this;if(el.style.display==='none'){el.style.display='';btn.textContent='收起 ▲'}else{el.style.display='none';btn.textContent='查看更多 ${rest.length} 家 ▼'}">
              查看更多 ${rest.length} 家 ▼</button>`
    }
    return h
  }

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
    ${renderDeclineList(decliningCusts)}
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

    <div class="sec-label">銷售資料</div>
    <div class="card" style="margin-bottom:12px">
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
      <div id="mgr-upload-log" style="display:none;margin-top:8px;font-size:11px;color:#65655C;background:#f5f4f0;border-radius:6px;padding:8px;max-height:80px;overflow-y:auto;font-family:monospace"></div>
    </div>

    <div class="sec-label">配額資料</div>
    <div class="card" style="margin-bottom:12px">
      <div class="card-top">
        <div style="flex:1"><div class="card-name">年度配額 Excel</div><div class="card-sub" id="mgr-quota-meta">載入中...</div></div>
        <span class="badge b-gray" id="mgr-quota-badge">—</span>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-primary" style="font-size:13px;flex:1;position:relative;overflow:hidden">
          <i class="ti ti-upload"></i> 上傳配額 Excel
          <input type="file" accept=".xlsx,.xls" style="position:absolute;inset:0;opacity:0;cursor:pointer" onchange="mgrUploadQuota(this)">
        </button>
      </div>
      <div id="mgr-quota-log" style="display:none;margin-top:8px;font-size:11px;color:#65655C;background:#f5f4f0;border-radius:6px;padding:8px;max-height:80px;overflow-y:auto;font-family:monospace"></div>
    </div>

  </div>`

  clearTimeout(_mgrTimeout)
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

  // 讀配額狀態
  sb.from('quota').select('*',{count:'exact',head:true}).then(({count,error})=>{
    const metaEl = document.getElementById('mgr-quota-meta')
    const badgeEl = document.getElementById('mgr-quota-badge')
    if (!metaEl||!badgeEl) return
    if (error||count===null||count===0) {
      metaEl.textContent='尚未上傳'
      badgeEl.textContent='未上傳'; badgeEl.className='badge b-gray'
    } else {
      sb.from('quota').select('period').order('period',{ascending:false}).limit(1).single()
        .then(({data:latest})=>{
          metaEl.textContent = count.toLocaleString()+' 筆'+(latest?.period?' · 最新 '+latest.period:'')
          badgeEl.textContent='已上傳'; badgeEl.className='badge b-success'
        })
    }
  })
}

// 管理後台上傳銷售檔
// 管理後台上傳配額（使用跟 admin 完全相同的解析邏輯）
function parseQuotaWS(ws){
  var raw=XLSX.utils.sheet_to_json(ws,{header:1,defval:null,raw:true});
  var hi=-1;
  for(var i=0;i<Math.min(raw.length,5);i++){if(raw[i]&&raw[i].indexOf('系列')>=0){hi=i;break;}}
  if(hi<0){log('⚠ 找不到配額標題列');return null;}
  var hdr=raw[hi];
  var iPe=hdr.indexOf('業務負責人');
  var iReg=hdr.indexOf('區域分類');
  var iUpdCh=hdr.indexOf('更新_客戶分類');
  var iMat=hdr.indexOf('材質');
  var iCat=hdr.indexOf('分類');
  var iSe=hdr.indexOf('系列');
  var mCols=[];
  hdr.forEach(function(v,ci){var n=parseFloat(v);if(n>=11501&&n<=11512)mCols.push({ci:ci,mo:String(Math.round(n)%100)});});
  log('配額欄位 pe='+iPe+' reg='+iReg+' updCh='+iUpdCh+' se='+iSe+' mCols='+mCols.length);

  // QUOTA[person][region][updCh] = { qh, qf, qtotal }
  // person='全通路' for global; updCh='' means whole region
  var OUT={};
  var curPe='';

  function getOrCreate(pe,reg,ch){
    if(!OUT[pe])OUT[pe]={};
    if(!OUT[pe][reg])OUT[pe][reg]={};
    if(!OUT[pe][reg][ch])OUT[pe][reg][ch]={qh:{},qf:{},qtotal:{}};
    return OUT[pe][reg][ch];
  }
  function addDetail(pe,reg,ch,se,ca,ma,monthly){
    var o=getOrCreate(pe,reg,ch);
    if(!o.qh[se])o.qh[se]={};
    if(!o.qh[se][ca])o.qh[se][ca]={mo:{},mats:{}};
    mCols.forEach(function(mc){
      o.qh[se][ca].mo[mc.mo]=(o.qh[se][ca].mo[mc.mo]||0)+monthly[mc.mo];
      if(!o.qf[se])o.qf[se]={};
      o.qf[se][mc.mo]=(o.qf[se][mc.mo]||0)+monthly[mc.mo];
    });
    if(ma&&!/^(total|TOTAL|Total)$/i.test(ma)){
      if(!o.qh[se][ca].mats[ma])o.qh[se][ca].mats[ma]={};
      mCols.forEach(function(mc){o.qh[se][ca].mats[ma][mc.mo]=(o.qh[se][ca].mats[ma][mc.mo]||0)+monthly[mc.mo];});
    }
  }

  for(var ri=hi+1;ri<raw.length;ri++){
    var row=raw[ri];if(!row)continue;
    if(row[iPe]&&String(row[iPe]).trim())curPe=String(row[iPe]).trim();
    var reg=row[iReg]?String(row[iReg]).trim():'';
    var updCh=row[iUpdCh]?String(row[iUpdCh]).trim():'';
    var se=row[iSe]?String(row[iSe]).trim():'';
    var ca=row[iCat]?String(row[iCat]).trim():'';
    var ma=row[iMat]?String(row[iMat]).trim():'';
    var monthly={};
    mCols.forEach(function(mc){monthly[mc.mo]=parseFloat(row[mc.ci])||0;});
    var isTot=/^(total|TOTAL|Total)$/i.test(se)||/^(total|TOTAL|Total)$/i.test(ca);

    if(reg==='全通路'){
      if(isTot)continue;
      addDetail('全通路','_','',se,ca,ma,monthly);
    } else if(curPe){
      if(isTot){
        var o=getOrCreate(curPe,reg,updCh);
        mCols.forEach(function(mc){o.qtotal[mc.mo]=(o.qtotal[mc.mo]||0)+monthly[mc.mo];});
      } else {
        if(!se||!ca)continue;
        addDetail(curPe,reg,updCh,se,ca,ma,monthly);
      }
    }
  }
  // Build 全區 aggregates: for each person, sum all regions into a '_ALL' key
  Object.keys(OUT).filter(function(pe){return pe!=='全通路';}).forEach(function(pe){
    OUT[pe]['_ALL']={};
    Object.keys(OUT[pe]).forEach(function(reg){
      if(reg==='_ALL')return;
      Object.keys(OUT[pe][reg]).forEach(function(ch){
        if(!OUT[pe]['_ALL'][ch])OUT[pe]['_ALL'][ch]={qh:{},qf:{},qtotal:{}};
        var src=OUT[pe][reg][ch], dst=OUT[pe]['_ALL'][ch];
        // merge qtotal
        Object.keys(src.qtotal).forEach(function(m){dst.qtotal[m]=(dst.qtotal[m]||0)+src.qtotal[m];});
        // merge qf
        Object.keys(src.qf).forEach(function(se){
          if(!dst.qf[se])dst.qf[se]={};
          Object.keys(src.qf[se]).forEach(function(m){dst.qf[se][m]=(dst.qf[se][m]||0)+src.qf[se][m];});
        });
        // merge qh
        Object.keys(src.qh).forEach(function(se){
          if(!dst.qh[se])dst.qh[se]={};
          Object.keys(src.qh[se]).forEach(function(ca){
            if(!dst.qh[se][ca])dst.qh[se][ca]={mo:{},mats:{}};
            Object.keys(src.qh[se][ca].mo||{}).forEach(function(m){
              dst.qh[se][ca].mo[m]=(dst.qh[se][ca].mo[m]||0)+src.qh[se][ca].mo[m];
            });
          });
        });
      });
    });
  });
  // ── Detect and remove summary rows ──────────────────
  // A ch='' row is a summary if its total ≈ sum of ch!='' rows of same pe (intra-pe)
  // OR ≈ sum of one ch='' row per other pe (cross-pe, e.g. 網路全區)
  var EPS=0.002;
  var allPeKeys=Object.keys(OUT).filter(function(k){return k!=='全通路';});

  function rowQTotal(o){return Object.values(o.qtotal||{}).reduce(function(s,v){return s+v;},0);}

  // Collect all ch='' rows per pe for cross-pe check
  var peCHEmptyRows={};
  allPeKeys.forEach(function(pe){
    peCHEmptyRows[pe]=[];
    Object.keys(OUT[pe]).forEach(function(reg){
      if(reg==='_ALL')return;
      if(OUT[pe][reg]['']){
        var t=rowQTotal(OUT[pe][reg]['']);
        if(t>0)peCHEmptyRows[pe].push({reg:reg,q:t,qtotal:OUT[pe][reg][''].qtotal||{}});
      }
    });
  });

  allPeKeys.forEach(function(pe){
    Object.keys(OUT[pe]).forEach(function(reg){
      if(reg==='_ALL')return;
      if(!OUT[pe][reg][''])return; // only check ch='' rows
      var q=rowQTotal(OUT[pe][reg]['']);
      if(q===0){delete OUT[pe][reg][''];return;}
      var skip=false;

      // Rule 1: intra-pe – ≈ sum of ch!='' rows of same pe
      var sameChTotal=0;
      Object.keys(OUT[pe]).forEach(function(reg2){
        if(reg2==='_ALL')return;
        Object.keys(OUT[pe][reg2]).forEach(function(ch2){
          if(ch2!=='')sameChTotal+=rowQTotal(OUT[pe][reg2][ch2]);
        });
      });
      if(sameChTotal>0&&Math.abs(q-sameChTotal)/Math.max(q,1)<EPS){skip=true;log('彙總(intra):'+pe+'/'+reg);}

      // Rule 1b: intra-pe – ≈ sum of ch!='' rows sharing same reg prefix (3 chars)
      if(!skip){
        var prefix=reg.substring(0,3);
        var relatedTotal=0,relatedCount=0;
        Object.keys(OUT[pe]).forEach(function(reg2){
          if(reg2==='_ALL')return;
          Object.keys(OUT[pe][reg2]).forEach(function(ch2){
            if(ch2!==''&&reg2.substring(0,3)===prefix){relatedTotal+=rowQTotal(OUT[pe][reg2][ch2]);relatedCount++;}
          });
        });
        if(relatedCount>0&&relatedTotal>0&&Math.abs(q-relatedTotal)/Math.max(q,1)<EPS){skip=true;log('彙總(intra-reg):'+pe+'/'+reg);}
      }

      // Rule 2: cross-pe – month-by-month check (all 12 months must match)
      // This prevents false positives from coincidental annual total matches
      if(!skip){
        var otherPes=allPeKeys.filter(function(p){return p!==pe;});
        var otherRows=[];
        otherPes.forEach(function(p){peCHEmptyRows[p].forEach(function(r){otherRows.push({pe:p,reg:r.reg,qtotal:r.qtotal,pe:p});});});
        var thisQtotal=OUT[pe][reg][''].qtotal||{};
        var allMos=Object.keys(thisQtotal);
        function tryCombosMonthly(rows, idx, usedPes, moSums){
          // Check if current moSums matches thisQtotal for all months
          var matches=allMos.every(function(m){
            var diff=Math.abs((thisQtotal[m]||0)-(moSums[m]||0));
            return diff<1||(thisQtotal[m]>0&&diff/thisQtotal[m]<EPS);
          });
          if(matches&&Object.keys(moSums).length>0)return true;
          if(idx>=rows.length)return false;
          var r=rows[idx];
          if(r['pe']!==pe&&usedPes.indexOf(r['pe'])<0){
            var newSums={};
            allMos.forEach(function(m){newSums[m]=(moSums[m]||0)+(r.qtotal[m]||0);});
            if(tryCombosMonthly(rows,idx+1,usedPes.concat([r['pe']]),newSums))return true;
          }
          return tryCombosMonthly(rows,idx+1,usedPes,moSums);
        }
        if(tryCombosMonthly(otherRows,0,[],{})){skip=true;log('彙總(cross-pe):'+pe+'/'+reg);}
      }

      if(skip){
        delete OUT[pe][reg][''];
        if(Object.keys(OUT[pe][reg]).length===0)delete OUT[pe][reg];
      }
    });
  });

  log('配額解析完成 people='+allPeKeys.join(','));
  return OUT;
}

window.mgrUploadQuota = async (inp) => {
  const file = inp.files[0]; if (!file) return
  const logEl = document.getElementById('mgr-quota-log')
  logEl.style.display = 'block'
  const addLog = (msg) => { logEl.textContent += msg + '\n'; logEl.scrollTop = logEl.scrollHeight }
  addLog('讀取 ' + file.name + '...')

  // 動態載入 XLSX
  if (!window.XLSX) {
    addLog('載入 XLSX 函式庫...')
    await new Promise(res => {
      const s = document.createElement('script')
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
      s.onload = res; document.head.appendChild(s)
    })
  }

  const wb = await new Promise(res => {
    const fr = new FileReader()
    fr.onload = e => res(XLSX.read(e.target.result, {type:'binary', raw:true}))
    fr.readAsBinaryString(file)
  })

  // 找配額工作表
  const qn = wb.SheetNames.find(n => n==='Y2026配額'||n==='2026配額')
    || wb.SheetNames.find(n => /^Y?\d{4}配額$/.test(n))
    || wb.SheetNames.find(n => n.includes('配額') && !n.includes('暫掛') && !n.includes('原始'))
  if (!qn) { addLog('⚠ 找不到配額工作表'); inp.value=''; return }
  addLog('工作表: ' + qn)

  // 用完整的 parseQuotaWS 解析（跟 admin 完全相同）
  // 暫時讓 parseQuotaWS 的 log 輸出到 quota log
  const _origLog = window.log
  window.log = addLog
  const quotaData = parseQuotaWS(wb.Sheets[qn])
  window.log = _origLog
  if (!quotaData) { addLog('⚠ 配額解析失敗'); inp.value=''; return }

  const peNames = Object.keys(quotaData).filter(pe => pe !== '全通路')
  addLog('找到業務: ' + peNames.join('、'))

  // 取 sales_rep 對照
  const { data: reps } = await sb.from('sales_rep').select('id,name').in('name', peNames)
  const repMap = {}
  ;(reps||[]).forEach(r => { repMap[r.name] = r.id })

  // 從 _ALL 取每月配額（跟儀表板邏輯一致）
  const year = new Date().getFullYear()
  const rows = []
  peNames.forEach(pe => {
    const repId = repMap[pe]
    if (!repId) { addLog('⚠ 找不到業務 ' + pe + ' 的帳號，略過'); return }
    // 直接從各 reg 的 qtotal 加總（最準確，跟儀表板 getBaseQ 邏輯一致）
    // 不用 _ALL，避免 ch 彙整邏輯差異
    const monthly = {}
    Object.keys(quotaData[pe]).filter(reg => reg !== '_ALL').forEach(reg => {
      Object.keys(quotaData[pe][reg]).forEach(ch => {
        const qt = quotaData[pe][reg][ch].qtotal || {}
        Object.keys(qt).forEach(mo => { monthly[mo] = (monthly[mo]||0) + qt[mo] })
      })
    })
    // 去重複：如果有空字串 ch 跟非空字串 ch 都存在，空字串是加總，不能再加
    // 所以：如果某個 reg 下有非空字串 ch，就減去空字串 ch 的部分
    const monthly2 = {}
    Object.keys(quotaData[pe]).filter(reg => reg !== '_ALL').forEach(reg => {
      const chs = Object.keys(quotaData[pe][reg])
      const hasNonEmpty = chs.some(ch => ch !== '')
      const chsToUse = hasNonEmpty ? chs.filter(ch => ch !== '') : chs
      chsToUse.forEach(ch => {
        const qt = quotaData[pe][reg][ch].qtotal || {}
        Object.keys(qt).forEach(mo => { monthly2[mo] = (monthly2[mo]||0) + qt[mo] })
      })
    })
    Object.entries(monthly2).forEach(([mo, amt]) => {
      const moNum = parseInt(mo)
      if (!moNum || moNum < 1 || moNum > 12) return
      rows.push({ rep_id: repId, period: year+'-'+String(moNum).padStart(2,'0'), amount_target: Math.round(amt), visit_target: 0 })
    })
  })

  if (!rows.length) { addLog('⚠ 無配額資料'); inp.value=''; return }
  addLog('準備寫入 ' + rows.length + ' 筆...')

  // Upsert
  let done = 0, errors = 0
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i+50)
    const { error } = await sb.from('quota').upsert(batch, {onConflict:'rep_id,period'})
    if (error) { errors += batch.length; addLog('⚠ ' + error.message.slice(0,80)) }
    else done += batch.length
  }

  if (errors === 0) {
    addLog('✅ 配額上傳完成：' + done + ' 筆')
    document.getElementById('mgr-quota-meta').textContent = done + ' 筆 · 剛才上傳'
    document.getElementById('mgr-quota-badge').textContent = '已上傳'
    document.getElementById('mgr-quota-badge').className = 'badge b-success'
  } else {
    addLog('⚠ 部分失敗：成功' + done + '，失敗' + errors)
  }
  inp.value = ''
}

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

let _visitCustomers = []  // 快取客戶清單
window.openVisitModal = async () => {
  document.getElementById('modal-visit').classList.add('open')
  // 重設欄位
  document.getElementById('visit-customer-search').value = ''
  document.getElementById('visit-customer-id').value = ''
  document.getElementById('selected-customer').style.display = 'none'
  document.getElementById('selected-customer').textContent = ''
  document.getElementById('customer-dropdown').style.display = 'none'
  document.getElementById('visit-amount').value = ''
  document.getElementById('visit-notes').value = ''

  // 載入客戶清單（用自己負責的）
  if (!_visitCustomers.length) {
    const q = sb.from('customer').select('id,name,type,grade').eq('is_active',true).order('name')
    const filtered = currentRep ? q.eq('assigned_rep_id', currentRep.id) : q
    const { data } = await filtered
    _visitCustomers = data || []
  }

  // 綁定 pill 選擇
  document.querySelectorAll('#visit-result-pills .pill').forEach(p => {
    p.onclick = () => {
      document.querySelectorAll('#visit-result-pills .pill').forEach(x=>x.classList.remove('selected'))
      p.classList.add('selected')
      visitResult = p.dataset.val
      document.getElementById('amount-group').style.display = visitResult==='成交'?'':'none'
    }
  })
  document.querySelectorAll('#visit-result-pills .pill')[0].click()
}

window.searchCustomers = (kw) => {
  const dd = document.getElementById('customer-dropdown')
  const kl = kw.trim().toLowerCase()

  if (!kl) {
    if (!_visitCustomers.length) { dd.style.display='none'; return }
    const typeMap = {}
    _visitCustomers.forEach(c => {
      const t = c.type || '其他'
      if (!typeMap[t]) typeMap[t] = {A:[],B:[],C:[],'未分級':[]}
      const g = ['A','B','C'].includes(c.grade) ? c.grade : '未分級'
      typeMap[t][g].push(c)
    })
    let html = ''
    Object.keys(typeMap).sort().forEach((type, ti) => {
      const grps = typeMap[type]
      const total = Object.values(grps).reduce((s,a)=>s+a.length,0)
      if (!total) return
      const tid = 'ddtype_'+ti
      // 預設全部收合
      html += `<div style="padding:6px 12px;font-size:12px;font-weight:600;color:#1A472A;background:#f0f8f4;border-bottom:1px solid #e8f4ec;cursor:pointer;display:flex;justify-content:space-between;align-items:center" onclick="
        var b=document.getElementById('${tid}');
        var a=document.getElementById('${tid}_arr');
        if(b.style.display==='none'){b.style.display='';a.textContent='▼'}else{b.style.display='none';a.textContent='▶'}
      ">
        <span>${type}（${total}）</span>
        <span id="${tid}_arr">▶</span>
      </div>
      <div id="${tid}" style="display:none">`
      ;['A','B','C','未分級'].forEach(grade => {
        const list = grps[grade]
        if (!list.length) return
        html += `<div style="padding:3px 12px 1px 16px;font-size:10px;color:#aaa;background:#fafafa">${grade} 級（${list.length}）</div>`
        list.forEach(c => {
          const safeName = c.name.replace(/'/g,"\'")
          const gradeColor = c.grade==='A'?'#C8A93B':c.grade==='B'?'#2C6FAC':'#888'
          const gradeBg = c.grade==='A'?'#FDF6DC':c.grade==='B'?'#E8F1FA':'#F0F0F0'
          html += `<div class="dropdown-item" style="padding:8px 12px 8px 24px" onclick="selectCustomer('${c.id}','${safeName}')">
            ${c.name}<span style="font-size:10px;font-weight:700;color:${gradeColor};background:${gradeBg};border-radius:3px;padding:1px 4px;margin-left:5px">${c.grade||''}</span>
          </div>`
        })
      })
      html += `</div>`
    })
    dd.innerHTML = html || '<div style="padding:10px 12px;color:#aaa;font-size:13px">無客戶資料</div>'
    dd.style.display = 'block'
    return
  }

  const hits = _visitCustomers.filter(c => c.name.toLowerCase().includes(kl)).slice(0,20)
  if (!hits.length) { dd.style.display='none'; return }
  dd.innerHTML = hits.map(c => {
    const safeName = c.name.replace(/'/g,"\'")
    return `<div class="dropdown-item" onclick="selectCustomer('${c.id}','${safeName}')">
      ${c.name}<span style="font-size:10px;color:#999;margin-left:6px">${c.type||''} ${c.grade||''}</span>
    </div>`
  }).join('')
  dd.style.display = 'block'
}
window.selectCustomer = (id, name) => {
  document.getElementById('visit-customer-id').value = id
  document.getElementById('visit-customer-search').value = ''
  document.getElementById('customer-dropdown').style.display = 'none'
  const sel = document.getElementById('selected-customer')
  sel.textContent = name
  sel.style.display = 'block'
}

window.closeVisitModal = (e) => {
  if (e.target===document.getElementById('modal-visit')) {
    document.getElementById('modal-visit').classList.remove('open')
    _editVisitId = null
  }
}

window.submitVisit = async () => {
  const customerIdVal = document.getElementById('visit-customer-id').value
  const amount = parseInt(document.getElementById('visit-amount').value)||0
  const notes = document.getElementById('visit-notes').value.trim()

  // 編輯模式
  if (_editVisitId) {
    const { error } = await sb.from('visit_log').update({
      result: visitResult,
      amount: visitResult==='成交'?amount:0,
      notes: notes||null,
      follow_up_status: visitResult==='待跟進'?'pending':'none'
    }).eq('id', _editVisitId)
    if (error) { alert('更新失敗：'+error.message); return }
    _editVisitId = null
    document.getElementById('modal-visit').classList.remove('open')
    document.getElementById('visit-amount').value = ''
    document.getElementById('visit-notes').value = ''
    renderToday()
    return
  }

  // 新增模式
  if (!todayRoute || !customerIdVal || customerIdVal === 'EDIT') return

  const { data: existing } = await sb.from('visit_log').select('id').eq('route_id',todayRoute.id)
  const order = (existing?.length||0) + 1

  const { error } = await sb.from('visit_log').insert({
    route_id: todayRoute.id, customer_id: customerIdVal,
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

// ── 編輯拜訪記錄 ──
let _editVisitId = null

window.openEditVisitModal = (id, custName, result, amount, notes) => {
  _editVisitId = id
  // 重用 visit modal，改標題
  document.getElementById('modal-visit').classList.add('open')
  // 填入現有資料
  document.getElementById('visit-customer-search').value = ''
  document.getElementById('visit-customer-id').value = 'EDIT' // 標記為編輯模式
  const selEl = document.getElementById('selected-customer')
  selEl.textContent = custName
  selEl.style.display = 'block'
  document.getElementById('visit-amount').value = amount || ''
  document.getElementById('visit-notes').value = notes || ''
  // 選對應的結果 pill
  document.querySelectorAll('#visit-result-pills .pill').forEach(p => {
    p.classList.toggle('selected', p.dataset.val === result)
    if (p.dataset.val === result) {
      visitResult = result
      document.getElementById('amount-group').style.display = result==='成交' ? '' : 'none'
    }
  })
}

window.deleteVisit = async (id) => {
  if (!confirm('確定刪除這筆拜訪記錄？')) return
  const { error } = await sb.from('visit_log').delete().eq('id', id)
  if (error) { alert('刪除失敗：'+error.message); return }
  renderToday()
}

// ── 里程計算 ──
// 動態載入 Google Maps JS SDK
function loadGMaps() {
  return new Promise(res => {
    if (window.google?.maps) { res(); return }
    const s = document.createElement('script')
    s.src = `https://maps.googleapis.com/maps/api/js?key=${GMAPS_KEY}&libraries=geometry`
    s.onload = res
    document.head.appendChild(s)
  })
}

function geocodeAddr(geocoder, address) {
  return new Promise((res, rej) => {
    geocoder.geocode({ address, region: 'TW' }, (results, status) => {
      if (status === 'OK') res(results[0].geometry.location)
      else rej(new Error('Geocode failed: ' + status + ' for ' + address))
    })
  })
}

function calcRoute(svc, origin, destination, waypoints) {
  return new Promise((res, rej) => {
    svc.route({
      origin, destination,
      waypoints: waypoints.map(w => ({ location: w, stopover: true })),
      optimizeWaypoints: true,
      travelMode: google.maps.TravelMode.DRIVING
    }, (result, status) => {
      if (status === 'OK') res(result)
      else rej(new Error('Directions failed: ' + status))
    })
  })
}

window.calcKm = async () => {
  if (!todayRoute || !currentRep) return
  const btn = document.getElementById('calc-km-btn')
  btn.textContent = '計算中...'
  btn.disabled = true

  try {
    await loadGMaps()

    // 拉今日拜訪的客戶地址
    const { data: visits } = await sb.from('visit_log')
      .select('visit_order, customer(id,name,actual_address,erp_address)')
      .eq('route_id', todayRoute.id).order('visit_order')

    if (!visits?.length) {
      alert('今日尚無拜訪記錄，無法計算里程')
      btn.textContent = '計算今日里程'; btn.disabled = false; return
    }

    // 取業務家裡地址
    const { data: repData } = await sb.from('sales_rep')
      .select('home_address').eq('id', currentRep.id).single()
    const homeAddr = repData?.home_address
    if (!homeAddr) {
      alert('業務家裡地址未設定，請聯繫管理者')
      btn.textContent = '計算今日里程'; btn.disabled = false; return
    }

    const geocoder = new google.maps.Geocoder()
    const dirSvc = new google.maps.DirectionsService()

    // Geocode 起點、終點、途徑點
    const originLatLng = await geocodeAddr(geocoder, COMPANY_ADDRESS)
    const destLatLng = await geocodeAddr(geocoder, homeAddr)

    const waypointLatLngs = []
    for (const v of visits) {
      const addr = v.customer?.actual_address || v.customer?.erp_address
      if (!addr) continue
      try {
        const latlng = await geocodeAddr(geocoder, addr)
        waypointLatLngs.push(latlng)
      } catch(e) {
        console.warn('地址 geocode 失敗:', addr)
      }
    }

    if (!waypointLatLngs.length) {
      alert('拜訪客戶皆無可辨識的地址')
      btn.textContent = '計算今日里程'; btn.disabled = false; return
    }

    // 計算路線
    const result = await calcRoute(dirSvc, originLatLng, destLatLng, waypointLatLngs)

    let totalMeters = 0
    for (const leg of result.routes[0].legs) totalMeters += leg.distance.value
    const totalKm = Math.round(totalMeters / 100) / 10

    // 存入 Supabase
    await sb.from('daily_route').update({ system_km: totalKm }).eq('id', todayRoute.id)
    todayRoute.system_km = totalKm

    document.getElementById('km-display').innerHTML = totalKm + '<span> km</span>'
    document.getElementById('km-sub').textContent = '預估油資 NT$' + Math.round(totalKm*4)

    // 取出優化後的拜訪順序
    const optimizedOrder = result.routes[0].waypoint_order  // Google 建議的索引順序
    const orderedVisits = optimizedOrder.map(i => visits[i])

    openReportKmModal(totalKm, orderedVisits, result.routes[0].legs)

  } catch(e) {
    alert('里程計算失敗：' + e.message)
    console.error(e)
  }
  btn.textContent = '計算今日里程'
  btn.disabled = false
}

// 業務回報里程 modal
window.openReportKmModal = (sysKm, orderedVisits, legs) => {
  const existing = document.getElementById('modal-km')
  if (existing) existing.remove()

  // 建立順序清單 HTML
  let routeHtml = ''
  if (orderedVisits?.length) {
    routeHtml = `
      <div style="margin-bottom:16px">
        <div style="font-size:12px;font-weight:600;color:#65655C;margin-bottom:8px">📍 建議拜訪順序</div>
        <div style="background:#f8f7f4;border-radius:8px;padding:10px">
          <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:0.5px solid #e8e6e0">
            <span style="font-size:10px;color:#aaa;width:20px;text-align:center">出發</span>
            <span style="font-size:12px;color:#65655C">公司（台中市西屯區廣福路150巷25號）</span>
          </div>
          ${orderedVisits.map((v,i) => {
            const leg = legs?.[i]
            const dist = leg ? (Math.round(leg.distance.value/100)/10)+'km' : ''
            const dur = leg ? Math.round(leg.duration.value/60)+'分' : ''
            return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:0.5px solid #e8e6e0">
              <span style="font-size:11px;font-weight:600;color:#1A472A;width:20px;text-align:center">${i+1}</span>
              <div style="flex:1">
                <div style="font-size:13px">${v.customer?.name||'—'}</div>
                <div style="font-size:10px;color:#aaa">${v.customer?.actual_address||v.customer?.erp_address||''}</div>
              </div>
              <div style="text-align:right;font-size:10px;color:#aaa">${dist}<br>${dur}</div>
            </div>`
          }).join('')}
          <div style="display:flex;align-items:center;gap:8px;padding:6px 0">
            <span style="font-size:10px;color:#aaa;width:20px;text-align:center">回</span>
            <span style="font-size:12px;color:#65655C">家</span>
          </div>
        </div>
      </div>`
  }

  const modal = document.createElement('div')
  modal.id = 'modal-km'
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:flex-end'
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px 16px 0 0;width:100%;padding:24px;max-height:85vh;overflow-y:auto">
      <div style="font-size:16px;font-weight:600;margin-bottom:4px">今日里程計算完成</div>
      <div style="font-size:13px;color:#999;margin-bottom:16px">系統計算最短路線：<span style="font-weight:600;color:#1A472A">${sysKm} km</span></div>
      ${routeHtml}
      <div style="margin-bottom:16px">
        <label style="font-size:12px;color:#65655C;display:block;margin-bottom:4px">您的實際里程（km）</label>
        <input id="km-input" type="number" step="0.1" value="${sysKm}"
          style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:16px;outline:none">
        <div style="font-size:11px;color:#aaa;margin-top:4px">與系統計算差異 &gt; 15% 需管理者審核</div>
      </div>
      <div style="display:flex;gap:10px">
        <button onclick="document.getElementById('modal-km').remove()"
          style="flex:1;padding:12px;border:1px solid #ddd;border-radius:8px;background:#f5f5f5;font-size:14px;cursor:pointer">取消</button>
        <button onclick="submitKm(${sysKm})"
          style="flex:2;padding:12px;border:none;border-radius:8px;background:#1A472A;color:#fff;font-size:14px;font-weight:500;cursor:pointer">確認送出</button>
      </div>
    </div>
  `
  document.body.appendChild(modal)
  document.getElementById('km-input').focus()
}

window.submitKm = async (sysKm) => {
  const gmapsKm = parseFloat(document.getElementById('km-input').value) || sysKm
  const diffPct = sysKm > 0 ? Math.abs(gmapsKm - sysKm) / sysKm : 0
  const needsReview = diffPct > 0.15

  // 更新 daily_route
  const updateData = { gmaps_km: gmapsKm }
  if (!needsReview) {
    // 差異小於 15%，直接用業務回報的
    updateData.approved_km = gmapsKm
  }
  await sb.from('daily_route').update(updateData).eq('id', todayRoute.id)
  todayRoute.gmaps_km = gmapsKm
  if (!needsReview) todayRoute.approved_km = gmapsKm

  document.getElementById('modal-km').remove()

  // 更新顯示
  document.getElementById('km-sub').textContent = needsReview
    ? `業務回報 ${gmapsKm}km｜差異 ${Math.round(diffPct*100)}%，待審核`
    : `業務回報 ${gmapsKm}km｜已確認`

  if (needsReview) {
    alert(`里程差異 ${Math.round(diffPct*100)}%（超過15%），已送出待管理者審核`)
  }
}

// ── 拜訪歷史 ──
async function renderHistory() {
  const c = document.getElementById('page-content')
  c.innerHTML = '<div class="loading"><div class="spinner"></div> 載入中</div>'
  if (!currentRep) return

  const day60ago = new Date(Date.now()-60*86400000).toISOString().slice(0,10)
  const { data: routes } = await sb.from('daily_route')
    .select('id,route_date')
    .eq('rep_id', currentRep.id)
    .gte('route_date', day60ago)
    .order('route_date', {ascending:false})

  if (!routes?.length) {
    c.innerHTML = '<div class="empty-state"><i class="ti ti-history"></i>近60天無拜訪記錄</div>'
    return
  }

  const routeIds = routes.map(r=>r.id)
  const routeDateMap = {}
  routes.forEach(r => { routeDateMap[r.id] = r.route_date })

  const { data: allVisits } = await sb.from('visit_log')
    .select('*, customer(id,name,type,grade)')
    .in('route_id', routeIds)
    .order('visited_at', {ascending:false})
    .limit(500)

  if (!allVisits?.length) {
    c.innerHTML = '<div class="empty-state"><i class="ti ti-history"></i>近60天無拜訪記錄</div>'
    return
  }

  const byDate = {}
  allVisits.forEach(v => {
    const date = routeDateMap[v.route_id] || v.visited_at?.slice(0,10)
    if (!byDate[date]) byDate[date] = []
    byDate[date].push(v)
  })

  const dates = Object.keys(byDate).sort((a,b)=>b.localeCompare(a))

  let html = `<div style="font-size:12px;color:#aaa;margin-bottom:12px">近60天拜訪記錄</div>`
  dates.forEach(date => {
    const dayVisits = byDate[date]
    const closed = dayVisits.filter(v=>v.result==='成交')
    const amt = closed.reduce((s,v)=>s+(v.amount||0),0)
    html += `<div style="margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:13px;font-weight:600">${date}</span>
        <span style="font-size:11px;color:#aaa">${dayVisits.length} 家｜成交 ${closed.length} 家${amt?'｜NT$'+amt.toLocaleString():''}</span>
      </div>
      ${dayVisits.map((v,i) => `
        <div class="card" style="border-left:3px solid ${v.result==='成交'?'#52B788':v.result==='待跟進'?'#EF9F27':'#ddd'};margin-bottom:6px">
          <div class="card-top">
            <div class="avatar ${avatarColors(i)}">${initials(v.customer?.name)}</div>
            <div style="flex:1">
              <div class="card-name">${v.customer?.name||'—'}</div>
              <div class="card-sub">${v.customer?.type||''} · ${new Date(v.visited_at).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'})}</div>
            </div>
            <span class="badge ${v.result==='成交'?'b-success':v.result==='待跟進'?'b-warn':'b-gray'}">${v.result}</span>
          </div>
          ${v.amount?`<div class="card-meta"><span><i class="ti ti-currency-dollar"></i>NT$${v.amount.toLocaleString()}</span></div>`:''}
          ${v.notes?`<div class="card-meta"><span><i class="ti ti-notes"></i>${v.notes}</span></div>`:''}
        </div>`).join('')}
    </div>`
  })
  c.innerHTML = html
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
