// ============================================================
// purchase-core.js  採購系統計算核心（純函式，不碰畫面與資料庫）
// 單位：庫存表、訂單、銷售都先用「主單位（包）」讀進來，計算時一律換成「箱」
// 判斷方式：只看「可撐天數」
//   可撐天數 = (庫存 − 受訂 + 在途 + 已下單) ÷ 每天賣幾箱
//   < 交期(45)      → 即刻缺貨：現在下單，貨到之前就會斷
//   交期 ～ 訂貨線(60) → 該訂貨了
//   ≥ 訂貨線        → 庫存充足
//   建議量 = 補到「目標天數(90)」需要的箱數
// ============================================================

export const DEFAULTS = {
  leadDays: 45,          // 下單到進倉天數；可撐天數低於這個 = 即刻缺貨
  reorderDays: 60,       // 可撐天數低於這個 = 該訂貨了
  targetDays: 90,        // 下單後要補到可撐幾天
  weeks: 26,             // 用最近幾週的銷售算平均
  openMode: 'big',       // 受訂量怎麼算：none 不扣／big 只扣大單／all 全部扣
  bigBoxes: 100,         // 大單 = 單筆訂單 ≥ 幾箱（自動計入）
  nearBoxes: 50,
  staleDays: 60,         // 超過「訂單只算最近 N 天」但在這個天數內的大筆訂單，列出來讓你確認（預設不計入）         // 接近大單 = 單筆 ≥ 幾箱但未達大單門檻（列出來讓你手動勾）
  orderDays: 30,         // 訂單表只算最近幾天內的訂單
  monthlyContainers: 8,  // 每月大概叫幾櫃（只用來提醒）
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
const rocDate = s => {
  const p = String(s || '').split('/')
  if (p.length !== 3) return null
  const y = parseInt(p[0]); const yy = y < 1911 ? y + 1911 : y
  return `${yy}-${p[1].padStart(2, '0')}-${p[2].padStart(2, '0')}`
}

// ── 分類：包寧安／小丸子／日貨尿布 ─────────────────────────
export const GROUPS = ['包寧安', '小丸子', '日貨尿布']
export const groupOf = series => series === '非經銷嬰褲' ? '日貨尿布' : series === '自有品牌成褲' ? '包寧安' : '小丸子'

// ── 解析 ERP 庫存表 SK041 ─────────────────────────────────
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

// ── 解析 ERP 訂單表 OR02：留下「最近 days 天內、未結清」的每一筆（主單位）──
// 太舊的訂單多半是沒刪掉的無效單，不算
export function parseOrders(rows, today, days = 30, staleDays = 60) {
  const from = addDays(today, -days)
  const staleFrom = addDays(today, -Math.max(days, staleDays))   // 超過 days 天但在 staleDays 內：只留大筆的讓人確認
  const lines = []
  let old = 0, closed = 0
  for (const r of rows) {
    const code = String(r['產品代號'] || '').trim()
    const date = rocDate(r['訂購日'])
    if (!code || !date) continue
    const qty = num(r['受訂量']) - num(r['受訂沖銷量']) - num(r['受訂取消量'])
    if (qty <= 0 || String(r['結清註記'] || '').trim()) { closed++; continue }
    if (date < staleFrom) { old++; continue }
    const stale = date < from
    if (stale) old++
    lines.push({ code, date, qty, stale, cust: String(r['客戶簡稱'] || r['客戶全稱'] || '').trim(), no: String(r['訂單單號'] || '').trim() })
  }
  return { lines, used: lines.filter(l => !l.stale).length, old, closed, from }
}

export const orderKey = l => `${l.no}|${l.code}|${l.date}`

// ── 把 SE11 轉成精簡銷售列 ─────────────────────────────────
export function salesFromSE11(rows, settings = DEFAULTS) {
  const out = []
  for (const r of rows) {
    const t = String(r['單別'] || '').trim()
    if (!settings.saleTypes.includes(t)) continue
    const code = String(r['產品代號'] || '').trim()
    const date = rocDate(r['日期'])
    if (!code || !date) continue
    out.push({ code, date, qty: num(r['主單位數量'] ?? r['數量']) })
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
  return { byCode, weeks: n, start, end: endDate }
}

const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0

// ── 主計算 ───────────────────────────────────────────────────
// state: { settings, inventory,
//   master:{code:{cbm,maker,containerCbm,discontinued,hidden,mergeInto}},
//   adj:{code:{onhand,erpAt,confirmed,carried,date}}  盤點數（箱）
//   ordered:{code:箱}        已向工廠下單、ERP 還沒建採購單（會保留到你清掉）
//   draft:{code:箱}          這次打算下單的量（只用來試算，不影響排序和狀態）
//   orderLines:[{code,date,qty,cust,no}] | null   訂單表 OR02
//   commitments:[{id,name,code,cartons,delivered,start,end}] }
export function compute(state, sales, today, salesEnd) {
  const S = { ...DEFAULTS, ...(state.settings || {}) }
  const master = state.master || {}, adj = state.adj || {}, ordered = state.ordered || {}, draft = state.draft || {}
  const invSrc = state.inventory || {}

  // 接替關係：舊品號 → 新品號（最多追兩層）
  const alias = {}
  for (const c in master) {
    let t = master[c].mergeInto
    if (!t || t === c) continue
    if (master[t] && master[t].mergeInto && master[t].mergeInto !== c) t = master[t].mergeInto
    if (t !== c) alias[c] = t
  }
  const wd = weeklyDemand(sales, salesEnd || today, S.weeks, alias)

  // 訂單明細，依新品號分組（舊品號的訂單換算成新品號）
  const linesBy = {}
  if (state.orderLines) for (const l of state.orderLines) (linesBy[alias[l.code] || l.code] ||= []).push(l)

  // 庫存、受訂、在途、已下單加總到新品號（舊品號的箱數換算成新品號的箱）
  const inv = {}, absorbed = [], hidden = []
  const codes = new Set([...Object.keys(invSrc), ...Object.values(alias)])
  for (const code of codes) {
    const src = invSrc[code]
    const tgt = alias[code] || code
    const base = invSrc[tgt] || src
    if (!base) continue
    const tgtPack = base.pack || 1
    if (!inv[tgt]) inv[tgt] = {
      code: tgt, name: invSrc[tgt] ? invSrc[tgt].name : `${tgt}（庫存表還沒有這個品號）`, series: base.series, category: base.category,
      pack: tgtPack, onhand: 0, skOpen: 0, transit: 0, ordered: 0, erpOnhand: 0, merged: [], packs: {}, adjusted: false, carried: false, confirmed: true, countDate: null
    }
    const t = inv[tgt]
    if (!src) continue
    const a = adj[code] || {}
    const f = (src.pack || 1) / tgtPack                    // 舊箱 → 新箱
    const erp = src.onhand / (src.pack || 1)
    const on = a.onhand != null ? a.onhand : erp
    t.packs[code] = src.pack || 1
    t.onhand += on * f
    t.erpOnhand += erp * f
    t.skOpen += src.open / tgtPack
    t.transit += src.transit / tgtPack
    t.ordered += (ordered[code] || 0) * f
    if (a.onhand != null) { t.adjusted = true; if (a.carried) t.carried = true; t.countDate = a.date || t.countDate }
    if (!a.confirmed) t.confirmed = false
    if (tgt !== code) { t.merged.push(code); absorbed.push({ code, name: src.name, target: tgt, onhand: on }) }
  }

  const items = []
  for (const code in inv) {
    const it = inv[code]
    const m = master[code] || {}
    if (m.hidden) { hidden.push({ code, name: it.name }); continue }
    const pack = it.pack || 1
    let w = (wd.byCode[code] || new Array(wd.weeks).fill(0)).map(v => v / pack)   // 箱/週
    const first = w.findIndex(v => v > 0)
    const isNew = first > 1                        // 新品：從第一次出貨那週開始平均
    if (isNew) w = w.slice(first)
    const weeklyAvg = Math.max(0, mean(w))
    const baseDaily = weeklyAvg / 7

    // 受訂量
    // 大單：單筆 ≥ bigBoxes 箱自動計入；接近大單（≥ nearBoxes）列出來讓人手動勾；手動勾選優先
    const pick = state.orderPick || {}
    const lines = (linesBy[code] || []).filter(l => !l.stale || l.qty / pack >= S.nearBoxes).map(l => {
      const boxes = l.qty / pack                       // 主單位(包) → 箱
      const key = orderKey(l)
      const big = boxes >= S.bigBoxes
      const near = !big && boxes >= S.nearBoxes
      const manual = key in pick
      const auto = big && !l.stale                         // 舊單不自動計入
      return { ...l, key, boxes, big, near, manual, picked: manual ? !!pick[key] : auto }
    }).sort((a, b) => (a.stale - b.stale) || b.boxes - a.boxes)
    const openAll = state.orderLines ? lines.filter(l => !l.stale || l.picked).reduce((s, l) => s + l.boxes, 0) : it.skOpen
    const openBig = lines.filter(l => l.picked).reduce((s, l) => s + l.boxes, 0)
    const nearOpen = lines.filter(l => !l.picked && (l.near || l.big))
    const open = S.openMode === 'none' ? 0 : S.openMode === 'all' ? openAll : (state.orderLines ? openBig : 0)

    // 標案／專案承諾量
    let tenderDaily = 0, tenderRemain = 0, tenderEnd = null
    for (const c of (state.commitments || []).filter(c => (alias[c.code] || c.code) === code)) {
      const remain = Math.max(0, (c.cartons || 0) - (c.delivered || 0))
      if (!remain || c.end < today) continue
      const from = c.start > today ? c.start : today
      const days = Math.max(1, diffDays(from, c.end) + 1)
      if (c.start <= addDays(today, S.targetDays)) tenderDaily += remain / days
      tenderRemain += remain
      if (!tenderEnd || c.end > tenderEnd) tenderEnd = c.end
    }

    const daily = baseDaily + tenderDaily
    const avail = it.onhand - open                           // 現貨可用
    const position = avail + it.transit + it.ordered         // 加上會進來的
    const coverDays = daily > 0 ? position / daily : Infinity
    const stockDays = daily > 0 ? avail / daily : Infinity
    const cbm = m.cbm || 0
    const contCbm = m.containerCbm || (it.series === '非經銷嬰褲' ? S.cbmJp : S.cbmOwn)
    const dq = Math.max(0, draft[code] || 0)
    const afterDays = daily > 0 ? (position + dq) / daily : Infinity

    const r = {
      code, name: it.name, series: it.series, category: it.category, group: groupOf(it.series), pack, maker: m.maker || '',
      weekly: w, weeklyAvg, daily, baseDaily, tenderDaily, isNew, weeksUsed: w.length,
      onhand: it.onhand, erpOnhand: it.erpOnhand, open, openAll, openBig, lines, nearOpen, transit: it.transit, ordered: it.ordered, avail, position,
      adjusted: it.adjusted, carried: it.carried, confirmed: it.confirmed, countDate: it.countDate, merged: it.merged,
      coverDays, stockDays, afterDays, draft: dq, draftCbm: dq * cbm, draftCont: cbm ? dq * cbm / contCbm : 0,
      stockoutDate: isFinite(stockDays) ? addDays(today, Math.max(0, Math.floor(stockDays))) : null,
      cbm, contCbm, contCartons: cbm > 0 ? Math.floor(contCbm / cbm) : 0,
      discontinued: !!m.discontinued, tenderRemain, tenderEnd,
      suggest: 0, status: 'ok', note: ''
    }

    if (r.discontinued) {
      const horizon = tenderEnd ? Math.max(0, diffDays(today, tenderEnd)) : 0
      r.need = tenderRemain + baseDaily * horizon
      r.gap = Math.max(0, r.need - position)
      if (avail < 0) { r.status = 'disc-short'; r.note = `受訂量已超過庫存 ${Math.ceil(-avail)} 箱` }
      else if (tenderRemain > 0 && r.gap > 0) { r.status = 'disc-short'; r.note = `標案到 ${tenderEnd} 還缺 ${Math.ceil(r.gap)} 箱` }
      else if (position <= 0) { r.status = 'disc-ok'; r.note = '已賣完' }
      else if (coverDays < S.reorderDays) { r.status = 'disc-low'; r.note = `約 ${Math.round(coverDays)} 天後賣完` }
      else { r.status = 'disc-ok'; r.note = isFinite(coverDays) ? `還可賣 ${(coverDays / 30).toFixed(1)} 個月` : '近期無銷售' }
    } else if (daily <= 0) {
      r.status = position > 0 ? 'ok' : 'idle'; r.note = position > 0 ? '近期無銷售' : '無庫存、近期無銷售'
    } else if (daily * 30 < 1 && position <= 0) {
      r.status = 'idle'; r.note = '銷量極低（每月不到 1 箱）'
    } else {
      r.status = coverDays < S.leadDays ? 'now' : coverDays < S.reorderDays ? 'soon' : 'ok'
      if (avail < 0) r.note = `受訂量已超過庫存 ${Math.ceil(-avail)} 箱`
      if (r.status !== 'ok') r.suggest = Math.max(0, Math.ceil(daily * S.targetDays - position))
    }
    if (isNew) r.note = (r.note ? r.note + '；' : '') + `只有 ${w.length} 週銷售資料`
    items.push(r)
  }

  const order = { now: 0, 'disc-short': 1, soon: 2, 'disc-low': 3, ok: 4, 'disc-ok': 5, idle: 6 }
  items.sort((a, b) => (order[a.status] - order[b.status]) || (a.coverDays - b.coverDays) || a.code.localeCompare(b.code))
  return { items, absorbed, hidden, weeks: wd.weeks, salesStart: wd.start, salesEnd: wd.end, settings: S }
}

// 這次訂購的合計（依目前顯示的品項）
export function draftTotals(items) {
  const t = { cartons: 0, cbm: 0, containers: 0, n: 0, noCbm: [], byMaker: {}, byGroup: {} }
  for (const r of items) {
    if (!(r.draft > 0)) continue
    t.n++; t.cartons += r.draft
    if (!r.cbm) { t.noCbm.push(r.code); continue }
    t.cbm += r.draftCbm; t.containers += r.draftCont
    for (const [k, o] of [[r.maker || '未設定工廠', t.byMaker], [r.group, t.byGroup]]) {
      const g = o[k] ||= { cartons: 0, cbm: 0, containers: 0 }
      g.cartons += r.draft; g.cbm += r.draftCbm; g.containers += r.draftCont
    }
  }
  return t
}
