import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = 'https://trxmfvosyfnlidmyelzs.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyeG1mdm9zeWZubGlkbXllbHpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyMTU5NDUsImV4cCI6MjA5Mzc5MTk0NX0.auFOS6ZtcmhsXMWBctFtRr-KnKmGDh4E5jhnk79Vbx0'
const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

let currentUser = null, currentRep = null, todayRoute = null, visitResult = '成交'

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
  document.getElementById('top-title').textContent = '業務總覽'
  const c = document.getElementById('page-content')
  c.innerHTML = '<div class="loading"><div class="spinner"></div> 載入中</div>'
  const period = today().slice(0,7)
  const { data: achievements, error: achErr } = await sb.from('monthly_achievement').select('*').eq('period',period)
  const { data: addrPending } = await sb.from('address_change_log').select('*, customer(name), sales_rep(name)').eq('status','pending')
  c.innerHTML = `
    <div class="sec-label">本月業績達成</div>
    ${!achievements?.length?'<div class="empty-state"><i class="ti ti-users"></i>尚無業務資料</div>'
      :achievements.map((a,i)=>`<div class="card">
        <div class="card-top"><div class="avatar ${avatarColors(i)}">${initials(a.rep_name)}</div>
        <div style="flex:1"><div class="card-name">${a.rep_name}</div><div class="card-sub">拜訪 ${a.actual_visits}/${a.visit_target} · NT$${((a.actual_amount||0)/1000).toFixed(0)}K</div></div>
        <span class="badge ${a.amount_pct>=100?'b-success':a.amount_pct>=60?'b-info':'b-danger'}">${Math.round(a.amount_pct||0)}%</span></div>
        <div class="prog-bar" style="margin-top:8px"><div class="prog-fill" style="width:${Math.min(Math.round(a.amount_pct||0),100)}%;background:${a.amount_pct>=100?'#3B6D11':a.amount_pct>=60?'#185FA5':'#A32D2D'}"></div></div>
      </div>`).join('')}
    ${addrPending?.length?`<div class="sec-label">地址差異待審核 (${addrPending.length})</div>
      ${addrPending.map(log=>`<div class="card">
        <div class="card-top"><div class="avatar av-amber">${initials(log.customer?.name)}</div>
        <div style="flex:1"><div class="card-name">${log.customer?.name}</div><div class="card-sub">由 ${log.sales_rep?.name} 提報</div></div>
        <span class="badge b-warn">待審核</span></div>
        <div class="card-note">舊：${log.old_address||'—'}<br>新：${log.new_address}</div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn-primary" style="font-size:13px;padding:8px" onclick="approveAddr('${log.id}')">確認更新</button>
          <button class="btn-outline" onclick="rejectAddr('${log.id}')">退回</button>
        </div>
      </div>`).join('')}`:''}
  `
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
