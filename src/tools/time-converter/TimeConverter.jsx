import React from 'react';
import { Clipboard, Sparkles } from 'lucide-react';

const FORMAT_OPTIONS = [
  { id: 'yyyy-MM-dd HH:mm:ss', name: 'yyyy-MM-dd HH:mm:ss' },
  { id: 'yyyyMMdd', name: 'yyyyMMdd 分区' },
  { id: 'yyyy-MM-dd', name: 'yyyy-MM-dd 日期' },
  { id: 'yyyy/MM/dd HH:mm:ss', name: 'yyyy/MM/dd HH:mm:ss' },
  { id: 'timestamp-ms', name: '时间戳毫秒' },
  { id: 'timestamp-s', name: '时间戳秒' },
];

function pad(value, length = 2) {
  return String(value).padStart(length, '0');
}

function toDateInputValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toDateTimeInputValue(date) {
  return `${toDateInputValue(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatDate(date, pattern) {
  if (pattern === 'timestamp-ms') return String(date.getTime());
  if (pattern === 'timestamp-s') return String(Math.floor(date.getTime() / 1000));

  const tokens = {
    yyyy: String(date.getFullYear()),
    MM: pad(date.getMonth() + 1),
    dd: pad(date.getDate()),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds()),
    SSS: pad(date.getMilliseconds(), 3),
  };

  return Object.entries(tokens).reduce((result, [token, value]) => result.replaceAll(token, value), pattern);
}

function parseTimestamp(value) {
  const trimmed = value.trim();
  if (!trimmed) return { date: null, error: '' };

  const timestamp = Number(trimmed);
  if (!Number.isFinite(timestamp)) return { date: null, error: '请输入合法数字时间戳' };

  const milliseconds = Math.abs(timestamp) < 100000000000 ? timestamp * 1000 : timestamp;
  const date = new Date(milliseconds);

  if (Number.isNaN(date.getTime())) return { date: null, error: '时间戳无法转换为有效日期' };
  return { date, error: '' };
}

function parseLocalDateTime(value) {
  if (!value.trim()) return { date: null, error: '' };

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: null, error: '请输入合法日期时间' };
  return { date, error: '' };
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function normalizeDateOnly(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildDateRange(startText, endText) {
  const start = normalizeDateOnly(startText);
  const end = normalizeDateOnly(endText);

  if (!start || !end) return { values: [], error: '请选择开始日期和结束日期' };
  if (start > end) return { values: [], error: '开始日期不能晚于结束日期' };

  const values = [];
  let cursor = new Date(start);

  while (cursor <= end && values.length <= 400) {
    values.push(formatDate(cursor, 'yyyyMMdd'));
    cursor = addDays(cursor, 1);
  }

  if (values.length > 400) return { values: [], error: '日期范围过大，请控制在 400 天以内' };
  return { values, error: '' };
}

function parseDateList(input) {
  return input
    .split(/[\s,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      if (/^\d{8}$/.test(item)) return item;
      const date = normalizeDateOnly(item);
      return date ? formatDate(date, 'yyyyMMdd') : item;
    });
}

function buildPartitionSql(partitionField, values) {
  const field = partitionField.trim() || 'dt';
  const quotedValues = values.map((value) => `'${value}'`);

  return {
    inCondition: `${field} IN (${quotedValues.join(', ')})`,
    betweenCondition: values.length > 1 ? `${field} >= '${values[0]}' AND ${field} <= '${values[values.length - 1]}'` : `${field} = '${values[0] ?? ''}'`,
    addPartitions: values.map((value) => `ALTER TABLE db.table ADD IF NOT EXISTS PARTITION (${field}='${value}');`).join('\n'),
  };
}

function ResultRow({ label, value }) {
  return (
    <div className="time-result-row">
      <span>{label}</span>
      <strong>{value || '-'}</strong>
    </div>
  );
}

function TimeConverter() {
  const now = React.useMemo(() => new Date(), []);
  const [timestampInput, setTimestampInput] = React.useState(String(Date.now()));
  const [dateTimeInput, setDateTimeInput] = React.useState(toDateTimeInputValue(now));
  const [formatPattern, setFormatPattern] = React.useState('yyyy-MM-dd HH:mm:ss');
  const [startDate, setStartDate] = React.useState(toDateInputValue(addDays(now, -6)));
  const [endDate, setEndDate] = React.useState(toDateInputValue(now));
  const [dateListInput, setDateListInput] = React.useState('');
  const [partitionField, setPartitionField] = React.useState('dt');
  const [copyText, setCopyText] = React.useState('复制结果');

  const timestampResult = React.useMemo(() => parseTimestamp(timestampInput), [timestampInput]);
  const dateTimeResult = React.useMemo(() => parseLocalDateTime(dateTimeInput), [dateTimeInput]);
  const rangeResult = React.useMemo(() => buildDateRange(startDate, endDate), [endDate, startDate]);
  const customDateValues = React.useMemo(() => parseDateList(dateListInput), [dateListInput]);
  const partitionValues = customDateValues.length > 0 ? customDateValues : rangeResult.values;
  const partitionSql = React.useMemo(() => buildPartitionSql(partitionField, partitionValues), [partitionField, partitionValues]);

  const loadNow = () => {
    const current = new Date();
    setTimestampInput(String(current.getTime()));
    setDateTimeInput(toDateTimeInputValue(current));
    setEndDate(toDateInputValue(current));
    setStartDate(toDateInputValue(addDays(current, -6)));
  };

  const copyOutput = async () => {
    const lines = [
      '【时间戳转换】',
      timestampResult.date ? `本地时间：${formatDate(timestampResult.date, 'yyyy-MM-dd HH:mm:ss')}` : timestampResult.error,
      '',
      '【日期时间转换】',
      dateTimeResult.date ? `毫秒时间戳：${dateTimeResult.date.getTime()}` : dateTimeResult.error,
      dateTimeResult.date ? `秒时间戳：${Math.floor(dateTimeResult.date.getTime() / 1000)}` : '',
      dateTimeResult.date ? `自定义格式：${formatDate(dateTimeResult.date, formatPattern)}` : '',
      '',
      '【分区条件】',
      partitionSql.inCondition,
      partitionSql.betweenCondition,
    ].filter((line) => line !== '').join('\n');

    await navigator.clipboard.writeText(lines);
    setCopyText('已复制');
    setTimeout(() => setCopyText('复制结果'), 1400);
  };

  const setRecentDays = (days) => {
    const current = new Date();
    setStartDate(toDateInputValue(addDays(current, -(days - 1))));
    setEndDate(toDateInputValue(current));
    setDateListInput('');
  };

  return (
    <>
      <section className="workspace-grid time-workspace utility-workspace">
        <article className="panel ddl-config-panel">
          <div className="panel-header">
            <h2>时间转换配置</h2>
            <div className="panel-tools">
              <button type="button" className="ghost" onClick={loadNow}><Sparkles size={15} />当前时间</button>
              <button type="button" onClick={copyOutput}><Clipboard size={15} />{copyText}</button>
            </div>
          </div>

          <div className="ddl-form-scroll">
            <section className="ddl-section">
              <h3>时间戳转换</h3>
              <div className="ddl-form-grid">
                <label className="setting-field ddl-field-wide">
                  <span>时间戳（自动识别秒 / 毫秒）</span>
                  <input value={timestampInput} onChange={(event) => setTimestampInput(event.target.value)} placeholder="1718841600000 或 1718841600" />
                </label>
              </div>
              {timestampResult.error && <p className="error-message">{timestampResult.error}</p>}
            </section>

            <section className="ddl-section">
              <h3>日期时间转换</h3>
              <div className="ddl-form-grid">
                <label className="setting-field">
                  <span>本地日期时间</span>
                  <input type="datetime-local" step="1" value={dateTimeInput} onChange={(event) => setDateTimeInput(event.target.value)} />
                </label>
                <label className="setting-field">
                  <span>输出格式</span>
                  <select value={formatPattern} onChange={(event) => setFormatPattern(event.target.value)}>
                    {FORMAT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                  </select>
                </label>
              </div>
              {dateTimeResult.error && <p className="error-message">{dateTimeResult.error}</p>}
            </section>

            <section className="ddl-section">
              <div className="ddl-section-title-row">
                <h3>日期分区生成</h3>
                <div className="time-quick-actions">
                  <button type="button" className="ghost" onClick={() => setRecentDays(7)}>近 7 天</button>
                  <button type="button" className="ghost" onClick={() => setRecentDays(30)}>近 30 天</button>
                </div>
              </div>
              <div className="ddl-form-grid">
                <label className="setting-field">
                  <span>开始日期</span>
                  <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
                </label>
                <label className="setting-field">
                  <span>结束日期</span>
                  <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
                </label>
                <label className="setting-field">
                  <span>分区字段</span>
                  <input value={partitionField} onChange={(event) => setPartitionField(event.target.value)} placeholder="dt" />
                </label>
                <label className="setting-field ddl-field-wide">
                  <span>自定义日期列表（可选，支持 yyyyMMdd / yyyy-MM-dd / 逗号 / 换行）</span>
                  <textarea className="time-date-list-input" value={dateListInput} onChange={(event) => setDateListInput(event.target.value)} spellCheck="false" placeholder="留空则使用开始/结束日期范围" />
                </label>
              </div>
              {rangeResult.error && customDateValues.length === 0 && <p className="error-message">{rangeResult.error}</p>}
            </section>
          </div>
        </article>

        <article className="panel output-panel">
          <div className="panel-header">
            <h2>转换结果</h2>
            <span>本地时区</span>
          </div>
          <div className="formatted-result time-result" aria-label="时间转换结果">
            <section className="time-result-card">
              <h3>时间戳 → 日期</h3>
              {timestampResult.date ? (
                <>
                  <ResultRow label="本地时间" value={formatDate(timestampResult.date, 'yyyy-MM-dd HH:mm:ss')} />
                  <ResultRow label="日期分区" value={formatDate(timestampResult.date, 'yyyyMMdd')} />
                  <ResultRow label="ISO 时间" value={timestampResult.date.toISOString()} />
                </>
              ) : <p className="empty-result">请输入时间戳后查看转换结果。</p>}
            </section>

            <section className="time-result-card">
              <h3>日期 → 时间戳</h3>
              {dateTimeResult.date ? (
                <>
                  <ResultRow label="毫秒" value={dateTimeResult.date.getTime()} />
                  <ResultRow label="秒" value={Math.floor(dateTimeResult.date.getTime() / 1000)} />
                  <ResultRow label="格式化" value={formatDate(dateTimeResult.date, formatPattern)} />
                </>
              ) : <p className="empty-result">请选择日期时间后查看时间戳。</p>}
            </section>

            <section className="time-result-card">
              <h3>分区 SQL</h3>
              {partitionValues.length > 0 ? (
                <>
                  <ResultRow label="分区数量" value={`${partitionValues.length} 个`} />
                  <pre>{partitionValues.join(', ')}</pre>
                  <pre>{partitionSql.inCondition}</pre>
                  <pre>{partitionSql.betweenCondition}</pre>
                  <pre>{partitionSql.addPartitions}</pre>
                </>
              ) : <p className="empty-result">请选择日期范围或输入自定义日期列表。</p>}
            </section>
          </div>
        </article>
      </section>

      <div className="compact-stats" aria-label="时间转换统计信息">
        <span>{partitionValues.length} 个分区</span>
        <span>{formatDate(new Date(), 'yyyy-MM-dd HH:mm:ss')}</span>
        <span>本地时区</span>
      </div>
    </>
  );
}

export default TimeConverter;
