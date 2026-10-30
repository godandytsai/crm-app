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

// ── 去除重複 id（同一檔案內同一張單同一序號出現多次）──────────
// 完全相同的列 → 直接去掉（通常是兩份匯出合併時的重疊區間）
// 同 id 但內容不同 → 保留最後一筆（較新的匯出），並回報出來讓人核對
export function dedupeRows(rows) {
  const map = new Map()
  let exact = 0, conflict = 0
  const samples = []
  const sig = r => JSON.stringify([r.order_date, r.customer_name, r.amount, r.quantity, r.category, r.material, r.sales_rep])
  for (const r of rows) {
    const prev = map.get(r.id)
    if (prev) {
      if (sig(prev) === sig(r)) exact++
      else {
        conflict++
        if (samples.length < 5) samples.push(`${r.id}（${prev.amount} → ${r.amount}）`)
      }
    }
    map.set(r.id, r)
  }
  return { rows: [...map.values()], exact, conflict, samples }
}

// ── 取得資料中的日期範圍（僅供上傳前預覽/警示用，不再拿來當刪除依據）──
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

// ── 上傳前的守門檢查：確認目前連線身分具備 manager/admin 權限 ────
// 這一步是提早攔截、給清楚的錯誤訊息用，讓使用者在上傳一開始就知道
// 要先登入，不用等批次跑到一半才被 deleteSalesByDateRange 的驗證擋下。
// 兩層防護疊在一起：這裡攔一次，deleteSalesByDateRange 裡的 count
// 驗證再攔一次，就算這裡漏放/漏呼叫，count 驗證仍然會擋下沒清乾淨的情況。
export async function ensureUploaderIsAuthorized(sb) {
  const { data: { session }, error: sessionError } = await sb.auth.getSession()
  if (sessionError) throw sessionError
  if (!session) {
    throw new Error('尚未登入。上傳銷售資料需要先用具備 manager/admin 角色的帳號登入（so_delete 政策要求），否則舊資料無法被正確清除、會產生孤兒資料。')
  }
  const { data: rep, error: repError } = await sb
    .from('sales_rep')
    .select('role')
    .eq('auth_user_id', session.user.id)
    .maybeSingle()
  if (repError) throw repError
  if (!rep || !['manager', 'admin'].includes(rep.role)) {
    throw new Error(`目前登入帳號的角色是「${rep?.role || '未設定'}」，沒有 manager/admin 權限，無法執行上傳（上傳會需要刪除該日期區間的舊資料）。`)
  }
  return session
}

// ── 刪除指定日期範圍的資料 ───────────────────────────────────
// ★ 修正重點：RLS政策擋下的DELETE不會回傳error，.delete()看起來
//   「執行成功」但實際上可能一列都沒刪掉（例如 so_delete 政策要求
//   manager/admin身分，但呼叫端用anon key沒登入，這時後端就是靜默地
//   刪除0筆）。所以刪除之後一定要再查一次這個範圍還剩幾筆，剩下的
//   一律視為失敗，直接丟出錯誤、不准繼續往下insert——寧可上傳中斷，
//   也不要讓新資料疊加在清不掉的舊資料上面，變成孤兒資料。
export async function deleteSalesByDateRange(sb, minDate, maxDate) {
  const { error } = await sb
    .from('sales_order')
    .delete()
    .gte('order_date', minDate)
    .lte('order_date', maxDate)
  if (error) throw error

  const { count, error: countError } = await sb
    .from('sales_order')
    .select('id', { count: 'exact', head: true })
    .gte('order_date', minDate)
    .lte('order_date', maxDate)
  if (countError) throw countError

  if (count && count > 0) {
    throw new Error(
      `刪除失敗：${minDate} ~ ${maxDate} 範圍內還殘留 ${count} 筆舊資料，沒有被清除。` +
      `最可能的原因是目前連線身分沒有 DELETE 權限（so_delete 政策要求 manager/admin 角色），` +
      `而 Supabase 對於被 RLS 擋下的刪除不會回傳錯誤，所以只能用這個方式抓出來。` +
      `請確認已用具備 manager/admin 角色的帳號登入後再重新上傳，本次上傳已中止、未寫入任何新資料。`
    )
  }
}

// ── 清除某年月的資料（手動清除用）────────────────────────────
export async function deleteSalesByMonth(sb, year, month) {
  const { error } = await sb.from('sales_order')
    .delete()
    .eq('year', year)
    .eq('month', month)
  if (error) throw error
}

// ── 上傳到 Supabase（先清除「呼叫端明確指定的完整日期區間」，再插入）──
// ★ 修正重點：刪除範圍不再從檔案內容（rows）反推 min/max，而是由呼叫端
//   明確傳入 targetRangeStart / targetRangeEnd（例如整季的 4/1 ~ 6/30）。
//   原本用 getDateRange(rows) 反推的做法有兩個漏洞：
//     1) 分月/分段上傳時，範圍只涵蓋這次檔案有的資料，範圍外的舊資料
//        （例如訂單日期被改到範圍外、或改期前的舊紀錄）永遠不會被清掉，
//        變成孤兒資料一直留在 Supabase 裡、跟新資料並存。
//     2) 就算整季上傳，只要季度頭尾剛好有一天完全沒出貨，min/max 也會
//        往內縮，縮進去的那一天如果 Supabase 裡有舊資料，一樣清不到。
//   現在強制呼叫端明確指定「這次要刷新的完整區間」，不管檔案裡實際
//   有沒有涵蓋到區間頭尾，都會整段刪除重建，孤兒資料無所遁形。
// onProgress(done, total, stage, msg)
// stage: 'deleting' | 'uploading'
export async function uploadSalesToSupabase(sb, rows, targetRangeStart, targetRangeEnd, onProgress) {
  const BATCH = 500

  // 0. 上傳前先確認身分具備 manager/admin 權限，才有辦法清除舊資料
  await ensureUploaderIsAuthorized(sb)

  // 0b. 刪除「之前」先去重，避免刪完舊資料才在中途撞到重複 id 失敗、留下資料缺口
  const dd = dedupeRows(rows)
  rows = dd.rows
  const dupWarnings = []
  if (dd.exact) dupWarnings.push(`檔案內有 ${dd.exact} 筆完全重複的資料，已自動去除（通常是兩份匯出期間重疊）`)
  if (dd.conflict) dupWarnings.push(`檔案內有 ${dd.conflict} 筆同單號同序號但內容不同，已保留最後一筆，請核對：${dd.samples.join('、')}`)

  if (!targetRangeStart || !targetRangeEnd) {
    throw new Error('必須明確指定要刪除重建的日期區間（targetRangeStart / targetRangeEnd），不可省略。例如整季上傳要傳 2026-04-01 ~ 2026-06-30，不能讓程式自己從檔案內容去猜。')
  }
  if (targetRangeStart > targetRangeEnd) {
    throw new Error(`日期區間錯誤：起始日期 ${targetRangeStart} 晚於結束日期 ${targetRangeEnd}`)
  }

  // 檢查：檔案裡的資料如果超出指定的刪除區間，就地攔下來提醒使用者
  // （這種狀況代表要嘛區間設錯了，要嘛檔案帶了不該在這次範圍內的資料）
  const { minDate, maxDate } = getDateRange(rows)
  const warnings = []
  if (minDate && minDate < targetRangeStart) {
    warnings.push(`檔案內有早於指定區間的資料（最早 ${minDate}，指定區間從 ${targetRangeStart} 開始），這些資料不會被正確覆蓋，請確認區間設定`)
  }
  if (maxDate && maxDate > targetRangeEnd) {
    warnings.push(`檔案內有晚於指定區間的資料（最晚 ${maxDate}，指定區間到 ${targetRangeEnd} 結束），這些資料不會被正確覆蓋，請確認區間設定`)
  }
  warnings.unshift(...dupWarnings)
  if (warnings.length && onProgress) {
    warnings.forEach(w => onProgress(0, rows.length, 'warning', w))
  }

  // 1. 刪除 Supabase 中「指定區間」的舊資料（不是檔案裡有資料的區間，是指定的完整區間）
  if (onProgress) onProgress(0, rows.length, 'deleting', `刪除 ${targetRangeStart} ~ ${targetRangeEnd} 舊資料...`)
  await deleteSalesByDateRange(sb, targetRangeStart, targetRangeEnd)

  // 2. 批次插入新資料
  let done = 0
  const total = rows.length
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const { error } = await sb.from('sales_order').upsert(batch, { onConflict: 'id' })
    if (error) throw error
    done += batch.length
    if (onProgress) onProgress(done, total, 'uploading', `上傳中 ${done}/${total} 筆`)
  }

  return { inserted: total, targetRangeStart, targetRangeEnd, warnings }
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
