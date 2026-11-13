// ============================================================
// purchase-core.js  採購系統計算核心（純函式，不碰畫面與資料庫）
// 單位：庫存表與銷售都先用「主單位（包）」讀進來，計算時一律換成「箱」
// ============================================================

export const DEFAULTS = {
  leadDays: 45,          // 下單到進倉天數
  z: 1.28,               // 服務水準：1.04=85% 1.28=90% 1.65=95% 2.05=98%
  weeks: 26,             // 用最近幾週的銷售算平均
  soonDays: 14,          // 幾天內會碰到訂貨點 → 「即將下單」
  cycleDays: 30,         // 併櫃品項一次補多少天的量
  mixMonths: 6,          // 一整櫃可賣超過幾個月 → 建議併櫃
  deductOpen: true,      // 是否扣受訂量
  batchSize: 4,          // 一批最多幾櫃（避免爆倉）
  cbmOwn: 65,            // 自有品牌一櫃 CBM
  cbmJp: 70,             // 日貨一櫃 CBM
  warehouses: ['良品倉', '大雅倉'],
  series: ['自有品牌成褲', '自有品牌嬰褲', '非經銷嬰褲'],
  saleTypes: ['出貨', '出退', '索樣']
}

const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : 0 }
const DAY = 86400000
export const toDate = s => new Date(s + 'T00:00:00Z')
export const fmtDate = d => d.toISOString().slice(0, 10)
export const addDays = (s, n) => fmtDate(new Date(toDate(s).getTime() + n * DAY))
export const diffDays = (a, b) => Math.round((toDate(b) - toDate(a)) / DAY)

// ── 解析 ERP 庫存表 SK041（sheet_to_json 的結果）──────────────
export function parseInventory(rows, settings = DEFAULTS) {
  const inv = {}
  for (const r of rows) {
    const code = String(r['產品代號'] || '').trim()
    const series = String(r['系列'] || '').trim()
    if (!code || !settings.series.includes(series)) continue
    const it = inv[code] || (inv[code] = {
      code, name: String(r['品名'] || '').trim(), series,
      category: String(r['分類'] || '').trim(), material: String(r['材質'] || '').trim(),
      pack: num(r['入數']) || 1, onhand: 0, open: 0, transit: 0
    })
    const wh = String(r['倉庫名稱'] || '').trim()
    if (settings.warehouses.includes(wh)) {
      it.onhand += num(r['目前庫存量(主單位)'])
      it.open += num(r['受訂量(主單位)'])
    }
    it.transit += num(r['採購量(主單位)'])   // 在途：所有倉別的採購未進量
  }
  return inv
}

// ── 把 SE11（或 Supabase sales_order）轉成精簡銷售列 ─────────
export function salesFromSE11(rows, settings = DEFAULTS) {
  const out = []
  for (const r of rows) {
    const t = String(r['單別'] || '').trim()
    if (!settings.saleTypes.includes(t)) continue
    const code = String(r['產品代號'] || '').trim()
    const p = String(r['日期'] || '').split('/')
    if (!code || p.length !== 3) continue
    const y = parseInt(p[0]); const yy = y < 1911 ? y + 1911 : y
    out.push({ code, date: `${yy}-${p[1].padStart(2, '0')}-${p[2].padStart(2, '0')}`, qty: num(r['主單位數量'] ?? r['數量']) })
  }
  return out
}

// ── 每週銷量（主單位）。週 = 以 endDate 為最後一天往回切的 7 天區間 ──
export function weeklyDemand(sales, endDate, weeks, alias = {}) {
  let minDate = null
  for (const s of sales) if (!minDate || s.date < minDate) minDate = s.date
  if (!minDate) return { byCode: {}, weeks: 0 }
  const avail = Math.floor((diffDays(minDate, endDate) + 1) / 7)
  const n = Math.max(0, Math.min(weeks, avail))
  const start = addDays(endDate, -n * 7 + 1)
  const byCode = {}
  for (const s of sales) {
    if (s.date < start || s.date > endDate) continue
    const code = alias[s.code] || s.code
    const i = Math.floor(diffDays(start, s.date) / 7)
    const a = byCode[code] || (byCode[code] = new Array(n).fill(0))
    a[i] += s.qty
  }
  return { byCode, weeks: n, start }
}

function stats(arr) {
  const n = arr.length
  if (!n) return { mean: 0, sd: 0 }
  const mean = arr.reduce((s, v) => s + v, 0) / n
  const sd = n > 1 ? Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : 0
  return { mean, sd }
}

// ── 主計算 ───────────────────────────────────────────────────
// state: { settings, inventory, master:{code:{cbm,maker,discontinued,mergeInto,containerCbm}},
//          adj:{code:{onhand?,transit?,open?,confirmed?}}  ← 手動調整，單位：箱
//          commitments:[{id,name,code,cartons,delivered,start,end}] }
export function compute(state, sales, today, salesEnd) {
  const S = { ...DEFAULTS, ...(state.settings || {}) }
  const master = state.master || {}, adj = state.adj || {}
  const alias = {}
  for (const c in master) if (master[c].mergeInto) alias[c] = master[c].mergeInto
  const wd = weeklyDemand(sales, salesEnd || today, S.weeks, alias)

  // 合併品號：庫存、受訂、在途加到主品號
  const inv = {}
  for (const code in state.inventory || {}) {
    const src = state.inventory[code]
    const a = adj[code] || {}
    const pack = src.pack || 1
    const v = {
      onhand: a.onhand != null ? a.onhand : src.onhand / pack,
      open: a.open != null ? a.open : src.open / pack,
      transit: a.transit != null ? a.transit : src.transit / pack
    }
    const tgt = alias[code] || code
    if (!inv[tgt]) inv[tgt] = { ...(state.inventory[tgt] || src), code: tgt, onhand: 0, open: 0, transit: 0, merged: [], erpOnhand: 0, adjusted: false, confirmed: true }
    const t = inv[tgt]
    t.onhand += v.onhand; t.open += v.open; t.transit += v.transit
    t.erpOnhand += src.onhand / pack
    if (a.onhand != null || a.transit != null || a.open != null) t.adjusted = true
    if (!a.confirmed) t.confirmed = false
    if (tgt !== code) t.merged.push(code)
  }

  const items = []
  for (const code in inv) {
    const it = inv[code]
    const m = master[code] || {}
    const pack = it.pack || 1
    let w = (wd.byCode[code] || new Array(wd.weeks).fill(0)).map(v => v / pack)   // 箱/週
    // 新品：從第一筆銷售那週開始算，避免被前面的 0 稀釋
    const first = w.findIndex(v => v > 0)
    const isNew = first > 1
    if (isNew) w = w.slice(first)
    const st = stats(w)
    const baseDaily = Math.max(0, st.mean / 7)

    // 標案／專案承諾量
    const cms = (state.commitments || []).filter(c => (alias[c.code] || c.code) === code)
    let tenderDaily = 0, tenderRemain = 0, tenderEnd = null
    for (const c of cms) {
      const remain = Math.max(0, (c.cartons || 0) - (c.delivered || 0))
      if (!remain || c.end < today) continue
      const from = c.start > today ? c.start : today
      const days = Math.max(1, diffDays(from, c.end) + 1)
      if (c.start <= addDays(today, S.leadDays + S.cycleDays)) tenderDaily += remain / days
      tenderRemain += remain
      if (!tenderEnd || c.end > tenderEnd) tenderEnd = c.end
    }

    const daily = baseDaily + tenderDaily
    const open = S.deductOpen ? it.open : 0
    const avail = it.onhand - open                 // 現貨可用（箱）
    const position = avail + it.transit            // 加在途
    const sdLead = (st.sd / Math.sqrt(7)) * Math.sqrt(S.leadDays)
    const safety = S.z * sdLead
    const rop = daily * S.leadDays + safety        // 訂貨點
    const coverDays = daily > 0 ? position / daily : Infinity
    const stockDays = daily > 0 ? avail / daily : Infinity
    const cbm = m.cbm || 0
    const contCbm = m.containerCbm || (it.series === '非經銷嬰褲' ? S.cbmJp : S.cbmOwn)
    const contCartons = cbm > 0 ? Math.floor(contCbm / cbm) : 0
    const contMonths = contCartons && daily > 0 ? contCartons / (daily * 30) : null

    const r = {
      code, name: it.name, series: it.series, category: it.category, pack, maker: m.maker || '',
      weekly: w, weeklyAvg: st.mean, weeklySd: st.sd, daily, baseDaily, tenderDaily, isNew, weeksUsed: w.length,
      onhand: it.onhand, erpOnhand: it.erpOnhand, open: it.open, transit: it.transit, avail, position,
      adjusted: it.adjusted, confirmed: it.confirmed, merged: it.merged,
      safety, rop, coverDays, stockDays,
      stockoutDate: isFinite(stockDays) ? addDays(today, Math.max(0, Math.floor(stockDays))) : null,
      cbm, contCbm, contCartons, contMonths,
      discontinued: !!m.discontinued, tenderRemain, tenderEnd,
      orderCartons: 0, orderContainers: 0, orderCbm: 0, mix: false, status: 'ok', note: ''
    }

    if (r.discontinued) {
      // 停產：不再建議補貨，只看剩下的量夠不夠
      const horizon = tenderEnd ? Math.max(0, diffDays(today, tenderEnd)) : 0
      const need = tenderRemain + baseDaily * horizon
      r.need = need
      r.gap = Math.max(0, need - position)
      if (avail < 0) { r.status = 'disc-short'; r.note = `受訂量已超過庫存 ${Math.ceil(-avail)} 箱` }
      else if (tenderRemain > 0 && r.gap > 0) { r.status = 'disc-short'; r.note = `標案到 ${tenderEnd} 還缺 ${Math.ceil(r.gap)} 箱` }
      else if (isFinite(coverDays) && coverDays < 60) { r.status = 'disc-low'; r.note = `約 ${Math.round(coverDays)} 天後賣完` }
      else { r.status = 'disc-ok'; r.note = isFinite(coverDays) ? `還可賣 ${(coverDays / 30).toFixed(1)} 個月` : '近期無銷售' }
    } else if (daily <= 0 && position <= 0) {
      r.status = 'idle'; r.note = '無庫存、近期無銷售'
    } else if (daily <= 0) {
      r.status = 'ok'; r.note = '近期無銷售'
    } else if (daily * 30 < 1 && position <= 0) {
      r.status = 'idle'; r.note = '銷量極低（每月不到 1 箱）'
    } else {
      if (position < rop) r.status = 'now'
      else if (position < rop + daily * S.soonDays) r.status = 'soon'
      if (coverDays < S.leadDays) r.risk = true     // 現在下單也來不及，到貨前會斷
      if (avail < 0) r.note = `受訂量已超過庫存 ${Math.ceil(-avail)} 箱`
      if (r.status !== 'ok') {
        const target = rop + daily * S.cycleDays     // 補到：訂貨點 + 一個補貨週期
        const deficit = Math.max(0, target - position)
        if (contCartons && contMonths != null && contMonths <= S.mixMonths) {
          r.orderContainers = Math.max(1, Math.ceil((rop - position) / contCartons))
          r.orderCartons = r.orderContainers * contCartons
        } else {
          r.mix = true
          r.orderCartons = Math.ceil(deficit)
          r.orderContainers = contCartons ? r.orderCartons / contCartons : 0
          if (!contCartons) r.note = (r.note ? r.note + '；' : '') + '缺材積資料，無法換算櫃數'
        }
        r.orderCbm = r.orderCartons * cbm
        r.afterMonths = (position + r.orderCartons) / (daily * 30)
      }
    }
    if (isNew) r.note = (r.note ? r.note + '；' : '') + `新品，僅 ${w.length} 週資料`
    items.push(r)
  }

  // 批次：最急的先叫，超過一批上限且還撐得住的排第二批
  const orders = items.filter(r => r.orderCartons > 0).sort((a, b) => a.coverDays - b.coverDays)
  let used = 0
  for (const r of orders) {
    const c = r.orderContainers
    if (used + c <= S.batchSize + 1e-9 || r.coverDays < S.leadDays + 14) { r.batch = 1; used += c }
    else r.batch = 2
  }

  const byMaker = {}
  for (const r of orders) {
    const k = r.maker || '未設定工廠'
    const g = byMaker[k] || (byMaker[k] = { maker: k, cbm: 0, cartons: 0, full: 0, mixCbm: 0, contCbm: r.contCbm })
    g.cbm += r.orderCbm; g.cartons += r.orderCartons
    if (r.mix) g.mixCbm += r.orderCbm; else g.full += r.orderContainers
  }
  for (const k in byMaker) { const g = byMaker[k]; g.mixContainers = g.mixCbm / g.contCbm; g.containers = g.full + g.mixContainers }

  const order = { now: 0, soon: 1, 'disc-short': 2, 'disc-low': 3, ok: 4, 'disc-ok': 5, idle: 6 }
  items.sort((a, b) => (order[a.status] - order[b.status]) || (a.coverDays - b.coverDays))
  return { items, orders, byMaker: Object.values(byMaker), weeks: wd.weeks, salesStart: wd.start, settings: S }
}
