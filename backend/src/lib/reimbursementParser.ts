// 报销单 Excel 解析器
// 支持两类模板：差旅费报销单(travel) / 一般费用报销单(general)
// 设计原则：尽量读取「干净单值」单元格；对分列填写的金额按「千/百/十/元/角/分」右对齐还原。
// 解析结果先交给用户核对，不直接当作最终真理。
import ExcelJS from 'exceljs';

export type ReimbursementType = 'travel' | 'general';

export interface ParsedLeg {
  legDate?: string; // 如 "7/8"
  transport?: string; // 高铁/飞机...
  fromStation?: string;
  toStation?: string;
  amount: number; // 金额小计（单值，干净）
  ticketCount?: number;
}

export interface ParsedItem {
  seq: number;
  category?: string; // 费用类型：住宿费/办公费用...
  summary?: string; // 摘要
  amount: number;
  note?: string;
}

export interface ParsedTrip {
  travelerName?: string;
  startDate?: string; // YYYY-MM-DD（尽力解析）
  endDate?: string;
  fromLocation?: string;
  toLocation?: string;
  headcount?: number;
  reason?: string; // 出差事由
  dateRangeText?: string; // 原始「起止时间」文本
  locationText?: string; // 原始「起止地点」文本
}

export interface ParsedReimbursement {
  type: ReimbursementType;
  applicantName: string;
  department?: string;
  projectName?: string;
  projectCode?: string;
  applyDate?: string;
  totalAmount: number; // 由明细求和得出，不信任手写大写
  trip?: ParsedTrip;
  legs?: ParsedLeg[];
  items: ParsedItem[]; // 一般费用明细 / 差旅费用汇总段
  rawTitle?: string;
}

// ---- 基础工具 ----
function val(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && 'text' in v) return String((v as { text: unknown }).text);
  if (typeof v === 'object' && 'result' in v) return String((v as { result: unknown }).result);
  return String(v);
}

function num(v: ExcelJS.CellValue): number {
  const s = val(v).replace(/[, ¥￥]/g, '').trim();
  if (s === '') return 0;
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

function intOrUndef(s: string): number | undefined {
  const n = parseInt(s, 10);
  return isNaN(n) ? undefined : n;
}

// 把「千/百/十/元/角/分」分列单元格（右对齐）还原成金额
// 例如 1287.52 -> [1,2,8,7,5,2]；600 -> [6,0,0,0,0] 右补齐为 [0,6,0,0,0,0]
function reconstructAmount(cells: ExcelJS.CellValue[]): number {
  const digits = cells
    .map((c) => val(c).trim())
    .filter((s) => s !== '')
    .map((s) => {
      const n = Number(s);
      return isNaN(n) ? 0 : n;
    });
  while (digits.length < 6) digits.unshift(0);
  const [q, b, s, y, j, f] = digits.slice(-6);
  return q * 1000 + b * 100 + s * 10 + y + j * 0.1 + f * 0.01;
}

function pad2(n: string | number): string {
  return String(n).padStart(2, '0');
}

// Excel 日期序列号 -> JS Date（Excel 以 1899-12-30 为 epoch）
function excelSerialToDate(serial: number): Date | null {
  if (serial < 20000 || serial > 60000) return null;
  const d = new Date((serial - 25569) * 86400 * 1000);
  return isNaN(d.getTime()) ? null : d;
}

function valToDate(v: ExcelJS.CellValue): Date | null {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') return excelSerialToDate(v);
  return null;
}

function detectType(ws: ExcelJS.Worksheet): ReimbursementType {
  let isTravel = false;
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      if (val(cell.value).includes('差旅')) isTravel = true;
    });
  });
  return isTravel ? 'travel' : 'general';
}

// get(ws, r, c) 用 1-based 行列号，等价于 Excel 的 A1 坐标
function get(ws: ExcelJS.Worksheet, r: number, c: number): ExcelJS.CellValue {
  return ws.getRow(r).getCell(c).value;
}

// ---- 差旅费报销单 ----
function parseTravel(ws: ExcelJS.Worksheet): ParsedReimbursement {
  const result: ParsedReimbursement = {
    type: 'travel',
    applicantName: '',
    items: [],
    legs: [],
    totalAmount: 0,
    rawTitle: val(get(ws, 1, 1)),
  };

  // 头部信息（csv 行号 = exceljs 行号 - 1）
  result.department = val(get(ws, 4, 2)); // 所属部门（合并区，值落在其后侧列）
  const pnRaw = val(get(ws, 4, 10)); // 所属项目（未填写时该格是标签本身）
  result.projectName = pnRaw === '所属项目' ? '' : pnRaw;
  const applicant = val(get(ws, 5, 2)); // 出差人员姓名
  result.applicantName = applicant;
  const dateVal = valToDate(get(ws, 4, 22)); // 日期：Excel 日期序列号
  const year = dateVal ? String(dateVal.getFullYear()) : '2026';
  if (dateVal) result.applyDate = dateVal.toISOString().slice(0, 10);

  const trip: ParsedTrip = {
    travelerName: applicant,
    reason: val(get(ws, 4, 15)), // 出差事由
    dateRangeText: val(get(ws, 6, 1)), // 起止时间：从7月6日至8月5日
    locationText: val(get(ws, 6, 13)), // 起止地点：南京 至 杭州、宁波、广州
    headcount: intOrUndef(val(get(ws, 6, 21)).replace(/[^0-9]/g, '')), // 出差人数：1人
  };

  // 起止时间 -> startDate/endDate
  const dm = trip.dateRangeText!.match(/从(\d{1,2})月(\d{1,2})日[^\d]*(\d{1,2})月(\d{1,2})日/);
  if (dm) {
    trip.startDate = `${year}-${pad2(dm[1])}-${pad2(dm[2])}`;
    trip.endDate = `${year}-${pad2(dm[3])}-${pad2(dm[4])}`;
  }
  // 起止地点 -> from/to（形如「南京 至 杭州、宁波、广州」）
  const rawLoc = trip.locationText!.replace(/^起止地点[:：]\s*/, '');
  const loc = rawLoc.match(/(.+?)\s*至\s*(.+)/);
  if (loc) {
    trip.fromLocation = loc[1].trim();
    trip.toLocation = loc[2].trim();
  }
  result.trip = trip;

  // 明细：行程段（左，col1-6）+ 费用汇总段（右，col13 + col20-25）
  // 数据起始行 = exceljs 第 9 行（csv 第 8 行），与表头行（col1="月  日"）相隔两行
  const datePattern = /^\d{1,2}\/\d{1,2}$/;
  for (let r = 9; r <= ws.rowCount; r++) {
    const dateCell = val(get(ws, r, 1));
    const projCell = val(get(ws, r, 13));
    if (dateCell === '' && projCell === '') break; // 两段都空 -> 结束

    // 行程段（仅当左列是日期）
    if (datePattern.test(dateCell)) {
      result.legs!.push({
        legDate: dateCell,
        transport: val(get(ws, r, 2)),
        fromStation: val(get(ws, r, 3)),
        toStation: val(get(ws, r, 4)),
        amount: num(get(ws, r, 5)), // 金额小计（单值）
        ticketCount: intOrUndef(val(get(ws, r, 6))), // 单据张数
      });
    }

    // 费用汇总段（右列 项目 + 报销金额分列）
    if (projCell && !projCell.includes('小计')) {
      result.items.push({
        seq: result.items.length + 1,
        category: projCell,
        amount: reconstructAmount([
          get(ws, r, 20),
          get(ws, r, 21),
          get(ws, r, 22),
          get(ws, r, 23),
          get(ws, r, 24),
          get(ws, r, 25),
        ]),
      });
    }
  }

  result.totalAmount = (result.legs ?? []).reduce((s, l) => s + l.amount, 0) +
    result.items.reduce((s, i) => s + i.amount, 0);
  return result;
}

// ---- 一般费用报销单 ----
function parseGeneral(ws: ExcelJS.Worksheet): ParsedReimbursement {
  const result: ParsedReimbursement = {
    type: 'general',
    applicantName: '',
    items: [],
    totalAmount: 0,
    rawTitle: val(get(ws, 2, 1)), // 费用报销单
  };

  // 头部信息
  const company = val(get(ws, 1, 1)); // 杭州知书科技有限公司
  result.applicantName = val(get(ws, 4, 3)); // 申请人
  result.department = val(get(ws, 4, 5)); // 部门
  const pnRaw = val(get(ws, 4, 7)); // 项目名称（未填时为标签）
  result.projectName = pnRaw === '项目名称' ? '' : pnRaw;
  const pcRaw = val(get(ws, 4, 8)); // 项目编号（未填时为标签）
  result.projectCode = pcRaw === '项目编号' ? '' : pcRaw;
  const adVal = valToDate(get(ws, 2, 9)); // 申请日期（真实日期或空）
  if (adVal) result.applyDate = adVal.toISOString().slice(0, 10);
  void company;

  // 明细：表头在 exceljs 第 5 行，数据从第 6 行起，遇到「合计」行结束
  // col2=序号, col3=摘要, col6=费用类型, col7=金额, col8=备注
  for (let r = 6; r <= ws.rowCount; r++) {
    const seqCell = val(get(ws, r, 2));
    if (seqCell === '' || seqCell.includes('合')) break; // 合计行
    const amount = num(get(ws, r, 7));
    const summary = val(get(ws, r, 3));
    const category = val(get(ws, r, 6));
    if (amount === 0 && summary === '' && category === '') continue; // 空白明细行
    result.items.push({
      seq: Number(seqCell) || result.items.length + 1,
      summary,
      category,
      amount,
      note: val(get(ws, r, 8)),
    });
  }

  result.totalAmount = result.items.reduce((s, i) => s + i.amount, 0);
  return result;
}

export async function parseReimbursementFile(
  buffer: Buffer,
  forcedType?: ReimbursementType,
): Promise<ParsedReimbursement> {
  const wb = new ExcelJS.Workbook();
  // @types/node v22 的 Buffer 是泛型，与 exceljs 期望的 Buffer 类型不完全兼容，这里做兼容转换
  await wb.xlsx.load(buffer as never);
  const ws = wb.worksheets[0];
  const type = forcedType ?? detectType(ws);
  return type === 'travel' ? parseTravel(ws) : parseGeneral(ws);
}
