import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── 設定 ────────────────────────────────────────────────────
const SUPABASE_URL = 'https://trxmfvosyfnlidmyelzs.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyeG1mdm9zeWZubGlkbXllbHpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyMTU5NDUsImV4cCI6MjA5Mzc5MTk0NX0.auFOS6ZtcmhsXMWBctFtRr-KnKmGDh4E5jhnk79Vbx0'

const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── 狀態 ────────────────────────────────────────────────────
let currentUser = null
let currentRep  = null
let todayRoute  = null
let visitResult = '成交'

// ── 工具函式 ─────────────────────────────────────────────────
function avatarColors(i) {
  const cls = ['av-blue','av-green','av-amber','av-red']
  return cls[i % cls.length]
}
function initials(name = '') {
  return name.replace(/\s/g,'').slice(0,2)
}
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, d2r = Math.PI/180
  const dLat = (lat2-lat1)*d2r, dLng = (lng2-lng1)*d2r
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*d2r)*Math.cos(lat2*d2r)*Math.sin(dLng/2)**2
  return Math.round(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))*1.2*10)/10
}
function today() { return new Date().toISOString().slice(0,10) }
function daysAgo(dateStr) {
  if (!dateStr) return null
  return Math.floor((Date.now() - new Date(dateStr))/86400000)
}
function visitUrgency(lastVisit, interval) {
  const days = daysAgo(lastVisit)
  if (days === null) return { cls:'b-danger', label:'從未拜訪' }
  const left = interval - days
  if (left < 0)  return { cls:'b-danger',  label:`逾期 ${Math.abs(left)} 天` }
  if (left <= 3) return { cls:'b-warn',    label:`${left} 天後到期` }
  return { cls:'b-gray', label:`${left} 天後` }
}

// ── 登入 / 登出 ───────────────────────────────────────────────
window.handleLogin = async () => {
  const email = document.getElementById('login-email').value.trim()
  const pwd   = document.getElementById('login-password').value
  const btn   = document.getElementById('btn-login')
  const err   = document.getElementById('login-error')

  btn.disabled = true
  btn.textContent = '登入中...'
  err.style.display = 'none'

  const { data, error } = await sb.auth.signInWithPassword({ email, password: pwd })
  if (error) {
    err.textContent = '帳號或密碼錯誤，請重試'
    err.style.display = 'block'
    btn.disabled = false
    btn.textContent = '登入'
    return
  }
  await afterLogin(data.user)
}

window.handleLogout = async () => {
  await sb.auth.signOut()
  currentUser = currentRep = todayRoute = null
  document.getElementById('screen-main').classList.remove('active')
  document.getElementById('screen-login').classList.add('active')
}

async function afterLogin(user) {
  currentUser = user
  const { data: rep } = await sb.from('sales_rep').select('*').eq('auth_user_id', user.id).single()
  currentRep = rep

  document.getElementById('screen-login').classList.remove('active')
  document.getElementById('screen-main').classList.add('active')

  const badge = document.getElementById('top-role-badge')
  if (rep?.role === 'manager' || rep?.role === 'admin') {
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

// ── 路由 ─────────────────────────────────────────────────────
window.switchPage = (page) => {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'))
  const navEl = document.getElementById('nav-'+page)
  if (navEl) navEl.classList.add('active')

  const titles = { today:'今日拜訪', customers:'我的客戶', pending:'待辦清單', stats:'我的數字' }
  document.getElementById('top-title').textContent = titles[page] || ''

  if (page === 'today')     renderToday()
  if (page === 'customers') renderCustomers()
  if (page === 'pending')   renderPending()
  if (page === 'stats')     renderStats()
}

// ── 今日拜訪 ──────────────────────────────────────────────────
async function renderToday() {
  const c = document.getElementById('page-content')
  c.innerHTML = '<div class="loading"><div class="spinner"></div> 載入中</div>'

  if (currentRep) {
    const { data: route } = await sb.from('daily_route')
      .select('*').eq('rep_id', currentRep.id).eq('route_date', today()).single()
    todayRoute = route

    if (!route) {
      const { data: newRoute } = await sb.from('daily_route')
        .insert({ rep_id: currentRep.id, route_date: today() }).select().single()
      todayRoute = newRoute
    }
  }

  const { data: visits } = todayRoute
    ? await sb.from('visit_log')
        .select('*, customer(id,name,type,grade,visit_interval_days)')
        .eq('route_id', todayRoute.id).order('visit_order')
    : { data: [] }

  const closed  = (visits||[]).filter(v => v.result === '成交')
  const totalAmt = closed.reduce((s,v) => s + (v.amount||0), 0)
  const sysKm   = todayRoute?.system_km || 0

  c.innerHTML = `
    <div class="metric-row">
      <div class="metric-card">
        <div class="mc-label">今日里程</div>
        <div class="mc-val">${sysKm}<span> km</span></div>
        <div class="mc-sub">預估油資 NT$${Math.round(sysKm*4)}</div>
      </div>
      <div class="metric-card">
        <div class="mc-label">成交家數</div>
        <div class="mc-val">${closed.length}<span> / ${(visits||[]).length}</span></div>
        <div class="mc-sub">成交率 ${visits?.length ? Math.round(closed.length/visits.length*100) : 0}%</div>
      </div>
    </div>
    <div class="metric-row">
      <div class="metric-card">
        <div class="mc-label">今日業績</div>
        <div class="mc-val" style="font-size:17px">NT$${totalAmt.toLocaleString()}</div>
      </div>
      <div class="metric-card">
        <div class="mc-label">拜訪筆數</div>
        <div class="mc-val">${(visits||[]).length}<span> 筆</span></div>
      </div>
    </div>
    <div class="sec-label">今日拜訪記錄</div>
    <button class="add-btn" onclick="openVisitModal()">
      <i class="ti ti-plus"></i> 新增拜訪
    </button>
    ${(visits||[]).length === 0
      ? '<div class="empty-state"><i class="ti ti-map-pin"></i>尚無拜訪記錄<br>點上方按鈕新增</div>'
      : (visits||[]).map((v,i) => `
        <div class="card">
          <div class="card-top">
            <div class="avatar ${avatarColors(i)}">${initials(v.customer?.name)}</div>
            <div style="flex:1">
              <div class="card-name">${v.customer?.name || '-'}</div>
              <div class="card-sub">${v.customer?.type || ''} · ${new Date(v.visited_at).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'})}</div>
            </div>
            <span class="badge ${v.result==='成交'?'b-success':v.result==='待跟進'?'b-warn':'b-gray'}">${v.result}</span>
          </div>
          <div class="card-meta">
            ${v.amount ? `<span><i class="ti ti-currency-dollar"></i>NT$${v.amount.toLocaleString()}</span>` : ''}
            ${v.notes ? `<span><i class="ti ti-notes"></i>${v.notes.slice(0,20)}${v.notes.length>20?'...':''}</span>` : ''}
          </div>
        </div>`).join('')
    }
  `
}

// ── 我的客戶 ──────────────────────────────────────────────────
async function renderCustomers() {
  const c = document.getElementById('page-content')
  c.innerHTML = '<div class="loading"><div class="spinner"></div> 載入中</div>'

  const { data: customers } = await sb.from('customer')
    .select('*, visit_log(visited_at, result)')
    .eq('is_active', true)
    .order('name')

  if (!customers?.length) {
    c.innerHTML = '<div class="empty-state"><i class="ti ti-building-store"></i>尚無客戶資料<br>請聯繫管理者匯入</div>'
    return
  }

  c.innerHTML = `
    <div class="sec-label">我的客戶 (${customers.length})</div>
    ${customers.map((cu,i) => {
      const lastVisit = cu.visit_log?.sort((a,b)=>new Date(b.visited_at)-new Date(a.visited_at))[0]?.visited_at
      const urg = visitUrgency(lastVisit, cu.visit_interval_days||21)
      return `
        <div class="card">
          <div class="card-top">
            <div class="avatar ${avatarColors(i)}">${initials(cu.name)}</div>
            <div style="flex:1">
              <div class="card-name">${cu.name}</div>
              <div class="card-sub">${cu.type||''} · 等級 ${cu.grade}</div>
            </div>
            <span class="badge ${urg.cls}">${urg.label}</span>
          </div>
          <div class="card-meta">
            <span><i class="ti ti-map-pin"></i>${cu.actual_address||cu.erp_address||'地址未設定'}</span>
          </div>
          ${cu.address_mismatch ? '<div class="card-note" style="color:#854F0B"><i class="ti ti-alert-triangle"></i> 地址差異待審核</div>' : ''}
        </div>`
    }).join('')}
  `
}

// ── 待辦清單 ──────────────────────────────────────────────────
async function renderPending() {
  const c = document.getElementById('page-content')
  c.innerHTML = '<div class="loading"><div class="spinner"></div> 載入中</div>'

  const { data: pending } = await sb.from('visit_log')
    .select('*, customer(id,name,type,grade,visit_interval_days), daily_route(route_date)')
    .eq('follow_up_status', 'pending')
    .order('created_at', { ascending: false })

  const { data: addrLogs } = currentRep ? await sb.from('address_change_log')
    .select('*, customer(name)')
    .eq('rep_id', currentRep.id)
    .eq('status', 'pending') : { data: [] }

  c.innerHTML = `
    ${addrLogs?.length ? `
      <div class="sec-label">地址待審核</div>
      ${addrLogs.map(log => `
        <div class="card">
          <div class="card-top">
            <div class="avatar av-amber">${initials(log.customer?.name)}</div>
            <div style="flex:1">
              <div class="card-name">${log.customer?.name}</div>
              <div class="card-sub">地址變更提報</div>
            </div>
            <span class="badge b-warn">待審核</span>
          </div>
          <div class="card-note">
            舊：${log.old_address||'—'}<br>
            新：${log.new_address}
          </div>
        </div>`).join('')}
    ` : ''}

    <div class="sec-label">待跟進客戶 ${pending?.length ? `(${pending.length})` : ''}</div>
    ${!pending?.length
      ? '<div class="empty-state"><i class="ti ti-checks"></i>沒有待跟進項目</div>'
      : pending.map((v,i) => `
        <div class="card">
          <div class="card-top">
            <div class="avatar ${avatarColors(i)}">${initials(v.customer?.name)}</div>
            <div style="flex:1">
              <div class="card-name">${v.customer?.name}</div>
              <div class="card-sub">${v.daily_route?.route_date} 拜訪</div>
            </div>
            <span class="badge b-warn">待跟進</span>
          </div>
          ${v.notes ? `<div class="card-note">${v.notes}</div>` : ''}
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="btn-ghost" onclick="markFollowUpDone('${v.id}')">標記完成</button>
          </div>
        </div>`).join('')
    }
  `
}

window.markFollowUpDone = async (id) => {
  await sb.from('visit_log').update({ follow_up_status: 'done' }).eq('id', id)
  renderPending()
}

// ── 我的數字 ──────────────────────────────────────────────────
async function renderStats() {
  const c = document.getElementById('page-content')
  c.innerHTML = '<div class="loading"><div class="spinner"></div> 載入中</div>'

  if (!currentRep) { c.innerHTML = '<div class="empty-state">請先登入</div>'; return }

  const period = today().slice(0,7)
  const { data: achievement } = await sb.from('monthly_achievement')
    .select('*').eq('rep_id', currentRep.id).eq('period', period).single()

  const { data: routes } = await sb.from('daily_route')
    .select('approved_km, system_km, gmaps_km')
    .eq('rep_id', currentRep.id)
    .gte('route_date', period+'-01')

  const totalKm = routes?.reduce((s,r) => s + (r.approved_km || r.gmaps_km || r.system_km || 0), 0) || 0

  const vPct  = achievement ? Math.min(Math.round(achievement.visit_pct), 100) : 0
  const aPct  = achievement ? Math.min(Math.round(achievement.amount_pct), 100) : 0

  c.innerHTML = `
    <div class="sec-label">本月達成 · ${period}</div>
    <div class="metric-row">
      <div class="metric-card">
        <div class="mc-label">拜訪家次</div>
        <div class="mc-val">${achievement?.actual_visits||0}<span>/${achievement?.visit_target||'-'}</span></div>
      </div>
      <div class="metric-card">
        <div class="mc-label">業績達成</div>
        <div class="mc-val">${aPct}<span>%</span></div>
      </div>
    </div>
    <div class="metric-row">
      <div class="metric-card">
        <div class="mc-label">累計里程</div>
        <div class="mc-val">${Math.round(totalKm)}<span> km</span></div>
        <div class="mc-sub">油資 NT$${Math.round(totalKm*4)}</div>
      </div>
      <div class="metric-card">
        <div class="mc-label">累計業績</div>
        <div class="mc-val" style="font-size:16px">NT$${((achievement?.actual_amount||0)/1000).toFixed(0)}K</div>
      </div>
    </div>
    <div class="sec-label">進度明細</div>
    <div class="card">
      <div class="prog-wrap">
        <div class="prog-label"><span>業績達成</span><span>NT$${((achievement?.actual_amount||0)/1000).toFixed(0)}K / ${((achievement?.amount_target||0)/1000).toFixed(0)}K</span></div>
        <div class="prog-bar"><div class="prog-fill" style="width:${aPct}%;background:#185FA5"></div></div>
      </div>
      <div class="prog-wrap">
        <div class="prog-label"><span>拜訪家次</span><span>${achievement?.actual_visits||0} / ${achievement?.visit_target||'-'} 次</span></div>
        <div class="prog-bar"><div class="prog-fill" style="width:${vPct}%;background:#3B6D11"></div></div>
      </div>
    </div>
  `
}

// ── 管理者總覽 ────────────────────────────────────────────────
async function renderManagerOverview() {
  document.getElementById('top-title').textContent = '業務總覽'
  const c = document.getElementById('page-content')
  c.innerHTML = '<div class="loading"><div class="spinner"></div> 載入中</div>'

  const period = today().slice(0,7)
  const { data: achievements } = await sb.from('monthly_achievement')
    .select('*').eq('period', period)

  const { data: addrPending } = await sb.from('address_change_log')
    .select('*, customer(name), sales_rep(name)').eq('status','pending')

  c.innerHTML = `
    <div class="sec-label">本月業績達成</div>
    ${!achievements?.length
      ? '<div class="empty-state"><i class="ti ti-users"></i>尚無業務資料</div>'
      : achievements.map((a,i) => `
        <div class="card">
          <div class="card-top">
            <div class="avatar ${avatarColors(i)}">${initials(a.rep_name)}</div>
            <div style="flex:1">
              <div class="card-name">${a.rep_name}</div>
              <div class="card-sub">拜訪 ${a.actual_visits}/${a.visit_target} · NT$${((a.actual_amount||0)/1000).toFixed(0)}K</div>
            </div>
            <span class="badge ${a.amount_pct>=100?'b-success':a.amount_pct>=60?'b-info':'b-danger'}">${Math.round(a.amount_pct||0)}%</span>
          </div>
          <div class="prog-bar" style="margin-top:8px"><div class="prog-fill" style="width:${Math.min(Math.round(a.amount_pct||0),100)}%;background:${a.amount_pct>=100?'#3B6D11':a.amount_pct>=60?'#185FA5':'#A32D2D'}"></div></div>
        </div>`).join('')
    }

    ${addrPending?.length ? `
      <div class="sec-label">地址差異待審核 (${addrPending.length})</div>
      ${addrPending.map(log => `
        <div class="card">
          <div class="card-top">
            <div class="avatar av-amber">${initials(log.customer?.name)}</div>
            <div style="flex:1">
              <div class="card-name">${log.customer?.name}</div>
              <div class="card-sub">由 ${log.sales_rep?.name} 提報</div>
            </div>
            <span class="badge b-warn">待審核</span>
          </div>
          <div class="card-note">
            舊：${log.old_address||'—'}<br>
            新：${log.new_address}
          </div>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="btn-primary" style="font-size:13px;padding:8px" onclick="approveAddr('${log.id}')">確認更新</button>
            <button class="btn-outline" onclick="rejectAddr('${log.id}')">退回</button>
          </div>
        </div>`).join('')}
    ` : ''}
  `
}

window.approveAddr = async (id) => {
  const { data: log } = await sb.from('address_change_log').select('*').eq('id',id).single()
  if (!log) return
  await sb.from('customer').update({
    actual_address: log.new_address, lat: log.new_lat, lng: log.new_lng,
    address_mismatch: false, address_updated_at: new Date().toISOString()
  }).eq('id', log.customer_id)
  await sb.from('address_change_log').update({
    status: 'approved', reviewed_by: currentRep?.id, reviewed_at: new Date().toISOString()
  }).eq('id', id)
  renderManagerOverview()
}

window.rejectAddr = async (id) => {
  await sb.from('address_change_log').update({ status: 'rejected' }).eq('id', id)
  await sb.from('customer').update({ address_mismatch: false })
    .eq('id', (await sb.from('address_change_log').select('customer_id').eq('id',id).single()).data?.customer_id)
  renderManagerOverview()
}

// ── 新增拜訪 Modal ────────────────────────────────────────────
window.openVisitModal = async () => {
  const sel = document.getElementById('visit-customer')
  sel.innerHTML = '<option>載入中...</option>'
  document.getElementById('modal-visit').classList.add('open')

  const { data: customers } = await sb.from('customer').select('id,name').eq('is_active',true).order('name')
  sel.innerHTML = customers?.map(c => `<option value="${c.id}">${c.name}</option>`).join('') || ''

  document.querySelectorAll('#visit-result-pills .pill').forEach(p => {
    p.onclick = () => {
      document.querySelectorAll('#visit-result-pills .pill').forEach(x => x.classList.remove('selected'))
      p.classList.add('selected')
      visitResult = p.dataset.val
      document.getElementById('amount-group').style.display = visitResult==='成交' ? 'flex' : 'none'
    }
  })
  document.querySelectorAll('#visit-result-pills .pill')[0].click()
}

window.closeVisitModal = (e) => {
  if (e.target === document.getElementById('modal-visit'))
    document.getElementById('modal-visit').classList.remove('open')
}

window.submitVisit = async () => {
  const customerId = document.getElementById('visit-customer').value
  const amount     = parseInt(document.getElementById('visit-amount').value) || 0
  const notes      = document.getElementById('visit-notes').value.trim()

  if (!todayRoute) return

  const { data: existing } = await sb.from('visit_log')
    .select('id').eq('route_id', todayRoute.id).order('visit_order', { ascending: false }).limit(1)
  const order = (existing?.[0] ? existing.length : 0) + 1

  await sb.from('visit_log').insert({
    route_id: todayRoute.id, customer_id: customerId,
    visit_order: order, result: visitResult,
    amount: visitResult==='成交' ? amount : 0,
    notes: notes || null,
    follow_up_status: visitResult==='待跟進' ? 'pending' : 'none',
    visited_at: new Date().toISOString()
  })

  document.getElementById('modal-visit').classList.remove('open')
  document.getElementById('visit-amount').value = ''
  document.getElementById('visit-notes').value  = ''
  renderToday()
}

// ── 初始化 ────────────────────────────────────────────────────
sb.auth.onAuthStateChange(async (event, session) => {
  if (session?.user && !currentUser) await afterLogin(session.user)
})

document.getElementById('login-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleLogin()
})
