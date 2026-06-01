// ============================================================
// upload.js - 銷售資料上傳模組
// 解析邏輯完全移植自儀表板，確保數字一致
// ============================================================

// ── 對應表（與儀表板完全相同）─────────────────────────────
const CH_REMAP = {
  '嬰兒房':'嬰藥','藥局':'嬰藥','藥局/嬰兒房':'嬰藥','機關福利社':'嬰藥',
  '安養院':'安養&醫材','醫院':'安養&醫材','醫院/安養院':'安養&醫材','醫療器材行':'安養&醫材',
  '盤商':'盤商(經銷商)','經銷商':'盤商(經銷商)'
}
const PE_REG_MAP = { '網路通路-1區':'雅蘋', '網路通路-2區':'張蓒' }
const CA_REMAP = {
  '幫寶適':'平行輸入&其他','大王':'平行輸入&其他','滿意寶寶':'平行輸入&其他',
  'P&G':'P&G+花王+暖暖包','小白兔暖暖包':'P&G+花王+暖暖包',
  '五月花':'五月花+得意+橘子工坊','得意':'五月花+得意+橘子工坊','橘子工坊':'五月花+得意+橘子工坊',
  '生活用品/五金':'其他','醫療器材':'其他'
}
const MA_REMAP = {
  '包寧安': {'尿片':'成褲','褲型':'成褲','黏貼型':'成褲','看護墊':'成褲'},
  '嬰舒寶': {'褲型':'嬰褲'},
  '櫻桃小丸子': {'褲型':'嬰褲','黏貼型':'嬰褲','禮箱':'嬰褲'},
  '胖虎': {'礦砂貓砂':'貓砂','豆腐貓砂':'貓砂'},
  '幫寶適': {'褲型':'他牌嬰褲&他牌濕巾','黏貼型':'他牌嬰褲&他牌濕巾'},
  '大王':   {'褲型':'他牌嬰褲&他牌濕巾','黏貼型':'他牌嬰褲&他牌濕巾'},
  '滿意寶寶': {'褲型':'他牌嬰褲&他牌濕巾'},
  '小白兔暖暖包': {'手握':'清潔用品','貼式':'清潔用品'},
  'P&G': {'清潔用品':'清潔用品'},
  '得意': {'清潔用品':'清潔用品','衛生紙':'清潔用品','贈品':'清潔用品'},
  '橘子工坊': {'清潔用品':'清潔用品'},
  '五月花': {'衛生紙':'清潔用品'},
  '生活用品/五金': {'個人潔淨保養':'其他','消耗品':'其他','清潔用品':'其他','衛生紙':'其他','食品/飲品':'其他'},
  '醫療器材': {'個人潔淨保養':'其他','清潔用品':'其他','醫療器材':'其他'}
}

function parseRoc(v) {
  const p = String(v||'').trim().split('/')
  if (p.length === 3) {
    const y = parseInt(p[0]) + 1911
    return { y, mo: parseInt(p[1]), day: parseInt(p[2]) }
  }
  return null
}

function getCaGroup(ca) { return CA_REMAP[ca] || ca }
function getMaGroup(ca, ma) {
  return (MA_REMAP[ca] && MA_REMAP[ca][ma]) || ma
}

// ── 解析 SE11 工作表（與儀表板 parseSalesWS 完全一致）──────
export function parseSalesWS(ws, XLSX) {
  const data = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false })
  const seenCtr = {}
  const rows = []

  for (const r of data) {
    const d = parseRoc(r['日期'])
    if (!d || !r['單別']) continue
    const t = String(r['單別']||'').trim()
    const orderNo = String(r['出貨單號']||'').trim()

    let seq
    if (r['序號'] !== null && r['序號'] !== undefined && r['序號'] !== '') {
      seq = String(Math.round(parseFloat(r['序號'])||0))
    } else {
      const ck = t + '_' + orderNo
      seenCtr[ck] = (seenCtr[ck]||0) + 1
      seq = String(seenCtr[ck])
    }

    const rawCh = String(r['客戶分類']||'').trim()
    const rawReg = String(r['區域分類']||'').trim()
    const updCh = CH_REMAP[rawCh] || (rawCh.indexOf('網')>=0||rawCh.indexOf('電商')>=0 ? '網路' : rawCh)
    const rawPe = String(r['業務姓名']||'').trim()
    const pe = PE_REG_MAP[rawReg] || rawPe
    const rawCa = String(r['分類']||'').trim()
    const rawMa = String(r['材質']||'').trim()
    const ma = (MA_REMAP[rawCa] && MA_REMAP[rawCa][rawMa]) || rawMa

    rows.push({
      id: t + '_' + orderNo + '_' + seq,
      order_type: t,
      order_date: `${d.y}-${String(d.mo).padStart(2,'0')}-${String(d.day).padStart(2,'0')}`,
      year: d.y,
      month: d.mo,
      day: d.day,
      customer_code: String(r['客戶代號']||'').trim(),
      customer_name: String(r['客戶全稱']||'').trim(),
      sales_rep: pe,
      region: rawReg,
      channel: updCh,
      raw_channel: rawCh,
      series: String(r['系列']||'').trim(),
      category: rawCa,
      quota_category: getCaGroup(rawCa),
      material: ma,
      raw_material: rawMa,
      material_group: getMaGroup(rawCa, rawMa),
      amount: parseFloat(String(r['未稅金額']||'0').replace(/,/g,''))||0,
      quantity: parseFloat(String(r['數量']||'0').replace(/,/g,''))||0
    })
  }
  return rows
}

// ── 取得資料中的日期範圍 ──────────────────────────────────────
export function getDateRange(rows) {
  let minDate = null, maxDate = null
  for (const r of rows) {
    const d = r.order_date // 'YYYY-MM-DD'
    if (!d) continue
    if (!minDate || d < minDate) minDate = d
    if (!maxDate || d > maxDate) maxDate = d
  }
  return { minDate, maxDate }
}

// ── 刪除指定日期範圍的資料 ───────────────────────────────────
export async function deleteSalesByDateRange(sb, minDate, maxDate) {
  const { error } = await sb
    .from('sales_order')
    .delete()
    .gte('order_date', minDate)
    .lte('order_date', maxDate)
  if (error) throw error
}

// ── 清除某年月的資料（手動清除用）────────────────────────────
export async function deleteSalesByMonth(sb, year, month) {
  const { error } = await sb.from('sales_order')
    .delete()
    .eq('year', year)
    .eq('month', month)
  if (error) throw error
}

// ── 上傳到 Supabase（先清除日期範圍，再插入）────────────────
// onProgress(done, total, stage, msg)
// stage: 'deleting' | 'uploading'
export async function uploadSalesToSupabase(sb, rows, onProgress) {
  const BATCH = 500

  // 1. 偵測檔案中的日期範圍
  const { minDate, maxDate } = getDateRange(rows)
  if (!minDate || !maxDate) throw new Error('無法取得日期範圍')

  // 2. 刪除 Supabase 中該日期範圍的舊資料
  if (onProgress) onProgress(0, rows.length, 'deleting', `刪除 ${minDate} ~ ${maxDate} 舊資料...`)
  await deleteSalesByDateRange(sb, minDate, maxDate)

  // 3. 批次插入新資料
  let done = 0
  const total = rows.length
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const { error } = await sb.from('sales_order').upsert(batch, { onConflict: 'id' })
    if (error) throw error
    done += batch.length
    if (onProgress) onProgress(done, total, 'uploading', `上傳中 ${done}/${total} 筆`)
  }

  return { inserted: total, minDate, maxDate }
}

// ── 查詢已上傳的資料範圍 ──────────────────────────────────────
export async function getSalesDataMeta(sb) {
  const { data, error } = await sb
    .from('sales_order')
    .select('year, month, order_type')
    .eq('order_type', '出貨')
  if (error || !data?.length) return null

  const months = [...new Set(data.map(r => `${r.year}-${String(r.month).padStart(2,'0')}`))]
  months.sort()
  return {
    count: data.length,
    from: months[0],
    to: months[months.length - 1],
    months
  }
}
