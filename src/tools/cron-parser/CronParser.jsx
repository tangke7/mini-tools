import React from 'react';
import { Clipboard, Sparkles } from 'lucide-react';

const CRON_EXAMPLES = [
  { name: '每 5 分钟', value: '*/5 * * * *' },
  { name: '每天 02:30', value: '30 2 * * *' },
  { name: '工作日 09:00', value: '0 9 * * MON-FRI' },
  { name: 'Quartz 每 10 秒', value: '0/10 * * * * ?' },
  { name: 'Quartz 每天中午', value: '0 0 12 * * ?' },
];

const CRON_MACROS = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@weekly': '0 0 * * SUN',
  '@monthly': '0 0 1 * *',
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
};

const MONTH_NAMES = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

const DAY_NAMES = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const FIELD_META = {
  second: { id: 'second', label: '秒', min: 0, max: 59 },
  minute: { id: 'minute', label: '分钟', min: 0, max: 59 },
  hour: { id: 'hour', label: '小时', min: 0, max: 23 },
  dayOfMonth: { id: 'dayOfMonth', label: '日', min: 1, max: 31 },
  month: { id: 'month', label: '月', min: 1, max: 12, names: MONTH_NAMES },
  dayOfWeek: { id: 'dayOfWeek', label: '周', min: 0, max: 7, names: DAY_NAMES },
  year: { id: 'year', label: '年', min: 1970, max: 2099 },
};

function range(min, max) {
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
}

function parseFieldValue(rawValue, meta) {
  const normalized = rawValue.trim().toUpperCase();

  if (meta.names?.[normalized] !== undefined) return meta.names[normalized];

  const value = Number(normalized);
  if (!Number.isInteger(value)) throw new Error(`${meta.label}字段包含无法识别的值：${rawValue}`);
  if (value < meta.min || value > meta.max) throw new Error(`${meta.label}字段超出范围：${rawValue}`);

  return value;
}

function parseCronField(source, meta) {
  const raw = source.trim();

  if (!raw) throw new Error(`${meta.label}字段不能为空`);
  if (/[LW#]/i.test(raw)) throw new Error(`${meta.label}字段暂不支持 L/W/# 等扩展语法`);
  if (raw === '*' || raw === '?') return { raw, wildcard: true, values: range(meta.min, meta.max) };

  const values = new Set();

  raw.split(',').forEach((part) => {
    const cleanPart = part.trim();
    if (!cleanPart) throw new Error(`${meta.label}字段包含空片段`);

    const stepParts = cleanPart.split('/');
    if (stepParts.length > 2) throw new Error(`${meta.label}字段步长语法无效：${cleanPart}`);

    const rangePart = stepParts[0];
    const step = stepParts[1] ? Number(stepParts[1]) : 1;
    if (!Number.isInteger(step) || step <= 0) throw new Error(`${meta.label}字段步长必须是正整数：${cleanPart}`);

    let start;
    let end;

    if (rangePart === '*' || rangePart === '?') {
      start = meta.min;
      end = meta.max;
    } else if (rangePart.includes('-')) {
      const [startRaw, endRaw] = rangePart.split('-');
      start = parseFieldValue(startRaw, meta);
      end = parseFieldValue(endRaw, meta);
    } else {
      start = parseFieldValue(rangePart, meta);
      end = stepParts[1] ? meta.max : start;
    }

    if (start > end) throw new Error(`${meta.label}字段范围起点不能大于终点：${cleanPart}`);

    for (let value = start; value <= end; value += step) {
      values.add(value);
    }
  });

  return { raw, wildcard: false, values: [...values].sort((left, right) => left - right) };
}

function normalizeExpression(expression) {
  const trimmed = expression.trim();
  return CRON_MACROS[trimmed.toLowerCase()] ?? trimmed;
}

function parseCronExpression(expression) {
  const normalized = normalizeExpression(expression);
  const parts = normalized.split(/\s+/).filter(Boolean);

  try {
    if (![5, 6, 7].includes(parts.length)) {
      throw new Error('Cron 表达式需要 5 段 Linux 格式，或 6/7 段 Quartz 格式');
    }

    const hasSeconds = parts.length >= 6;
    const fields = hasSeconds
      ? {
        second: parseCronField(parts[0], FIELD_META.second),
        minute: parseCronField(parts[1], FIELD_META.minute),
        hour: parseCronField(parts[2], FIELD_META.hour),
        dayOfMonth: parseCronField(parts[3], FIELD_META.dayOfMonth),
        month: parseCronField(parts[4], FIELD_META.month),
        dayOfWeek: parseCronField(parts[5], FIELD_META.dayOfWeek),
        year: parts[6] ? parseCronField(parts[6], FIELD_META.year) : { raw: '*', wildcard: true, values: range(FIELD_META.year.min, FIELD_META.year.max) },
      }
      : {
        second: { raw: '0', wildcard: false, values: [0] },
        minute: parseCronField(parts[0], FIELD_META.minute),
        hour: parseCronField(parts[1], FIELD_META.hour),
        dayOfMonth: parseCronField(parts[2], FIELD_META.dayOfMonth),
        month: parseCronField(parts[3], FIELD_META.month),
        dayOfWeek: parseCronField(parts[4], FIELD_META.dayOfWeek),
        year: { raw: '*', wildcard: true, values: range(FIELD_META.year.min, FIELD_META.year.max) },
      };

    return { error: '', cron: { normalized, parts, hasSeconds, mode: hasSeconds ? 'Quartz' : 'Linux', fields } };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Cron 表达式解析失败', cron: null };
  }
}

function matchesDay(cron, date) {
  const dayOfMonthField = cron.fields.dayOfMonth;
  const dayOfWeekField = cron.fields.dayOfWeek;
  const dayOfMonthMatch = dayOfMonthField.values.includes(date.getDate());
  const weekDay = date.getDay();
  const dayOfWeekMatch = dayOfWeekField.values.includes(weekDay) || (weekDay === 0 && dayOfWeekField.values.includes(7));

  if (dayOfMonthField.wildcard && dayOfWeekField.wildcard) return true;
  if (dayOfMonthField.wildcard) return dayOfWeekMatch;
  if (dayOfWeekField.wildcard) return dayOfMonthMatch;

  return dayOfMonthMatch || dayOfWeekMatch;
}

function matchesMinute(cron, date) {
  return cron.fields.year.values.includes(date.getFullYear())
    && cron.fields.month.values.includes(date.getMonth() + 1)
    && cron.fields.hour.values.includes(date.getHours())
    && cron.fields.minute.values.includes(date.getMinutes())
    && matchesDay(cron, date);
}

function findNextRuns(cron, count) {
  const now = new Date();
  const cursor = new Date(now);
  const runs = [];
  const maxMinutes = 366 * 24 * 60 * 3;

  cursor.setMilliseconds(0);
  cursor.setSeconds(0);

  for (let minuteIndex = 0; minuteIndex < maxMinutes && runs.length < count; minuteIndex += 1) {
    if (matchesMinute(cron, cursor)) {
      cron.fields.second.values.forEach((second) => {
        if (runs.length >= count) return;
        const candidate = new Date(cursor);
        candidate.setSeconds(second, 0);

        if (candidate > now) runs.push(candidate);
      });
    }

    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  return { runs, exhausted: runs.length < count };
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDateTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function summarizeValues(field) {
  if (field.wildcard) return '任意';
  if (field.values.length > 10) return `${field.values.slice(0, 8).join(', ')} ... 共 ${field.values.length} 个值`;
  return field.values.join(', ');
}

function fieldRows(cron) {
  const rows = [
    ['second', cron.fields.second],
    ['minute', cron.fields.minute],
    ['hour', cron.fields.hour],
    ['dayOfMonth', cron.fields.dayOfMonth],
    ['month', cron.fields.month],
    ['dayOfWeek', cron.fields.dayOfWeek],
  ];

  if (!cron.fields.year.wildcard) rows.push(['year', cron.fields.year]);
  return rows;
}

function CronParser() {
  const [expression, setExpression] = React.useState('0 9 * * MON-FRI');
  const [count, setCount] = React.useState(8);
  const [copyText, setCopyText] = React.useState('复制时间');

  const parsed = React.useMemo(() => parseCronExpression(expression), [expression]);
  const schedule = React.useMemo(() => parsed.cron ? findNextRuns(parsed.cron, count) : { runs: [], exhausted: false }, [count, parsed.cron]);
  const bothDayFieldsRestricted = parsed.cron && !parsed.cron.fields.dayOfMonth.wildcard && !parsed.cron.fields.dayOfWeek.wildcard;

  const copyRuns = async () => {
    const output = schedule.runs.map((date, index) => `${index + 1}. ${formatDateTime(date)} ${WEEKDAY_NAMES[date.getDay()]}`).join('\n');
    await navigator.clipboard.writeText(output || '未找到执行时间');
    setCopyText('已复制');
    setTimeout(() => setCopyText('复制时间'), 1400);
  };

  return (
    <>
      <section className="workspace-grid cron-workspace utility-workspace">
        <article className="panel ddl-config-panel">
          <div className="panel-header">
            <h2>Cron 表达式解析器</h2>
            <span>Linux / Quartz</span>
          </div>

          <div className="ddl-form-scroll">
            <section className="ddl-section">
              <h3>表达式</h3>
              <div className="ddl-form-grid">
                <label className="setting-field ddl-field-wide">
                  <span>Cron</span>
                  <input value={expression} onChange={(event) => setExpression(event.target.value)} placeholder="*/5 * * * * 或 0/10 * * * * ?" spellCheck="false" />
                </label>
                <label className="setting-field">
                  <span>展示次数</span>
                  <select value={count} onChange={(event) => setCount(Number(event.target.value))}>
                    <option value="5">5 次</option>
                    <option value="8">8 次</option>
                    <option value="12">12 次</option>
                    <option value="20">20 次</option>
                  </select>
                </label>
              </div>
              <div className="cron-example-list">
                {CRON_EXAMPLES.map((example) => (
                  <button type="button" className="ghost" key={example.value} onClick={() => setExpression(example.value)}>
                    <Sparkles size={14} />{example.name}
                  </button>
                ))}
              </div>
              {parsed.error && <p className="error-message">{parsed.error}</p>}
              {bothDayFieldsRestricted && <p className="utility-warning">日字段和周字段同时受限时，按常见 Linux Cron 语义使用“或”匹配。</p>}
            </section>

            {parsed.cron && (
              <section className="ddl-section">
                <h3>字段解释</h3>
                <div className="cron-field-grid">
                  {fieldRows(parsed.cron).map(([key, field]) => (
                    <div className="cron-field-row" key={key}>
                      <strong>{FIELD_META[key].label}</strong>
                      <span>{field.raw}</span>
                      <small>{summarizeValues(field)}</small>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </article>

        <article className="panel output-panel">
          <div className="panel-header">
            <h2>最近执行时间</h2>
            <div className="panel-tools">
              <button type="button" onClick={copyRuns} disabled={!schedule.runs.length}><Clipboard size={15} />{copyText}</button>
            </div>
          </div>
          <div className="formatted-result cron-result" aria-label="Cron 最近执行时间">
            {parsed.error ? (
              <p className="empty-result">请输入合法 Cron 表达式后查看最近执行时间。</p>
            ) : (
              <>
                <div className="cron-summary-card">
                  <strong>{parsed.cron.mode} Cron</strong>
                  <span>{parsed.cron.normalized}</span>
                </div>
                <div className="cron-run-list">
                  {schedule.runs.map((date, index) => (
                    <div className="cron-run-row" key={date.getTime()}>
                      <span>#{index + 1}</span>
                      <strong>{formatDateTime(date)}</strong>
                      <small>{WEEKDAY_NAMES[date.getDay()]}</small>
                    </div>
                  ))}
                </div>
                {schedule.exhausted && <p className="utility-warning">未来 3 年内未找到足够多的执行时间，请检查表达式或年份范围。</p>}
              </>
            )}
          </div>
        </article>
      </section>

      <div className="compact-stats" aria-label="Cron 统计信息">
        <span>{parsed.cron ? parsed.cron.mode : '解析失败'}</span>
        <span>{schedule.runs.length} 个最近时间</span>
        <span>当前时间 {formatDateTime(new Date())}</span>
      </div>
    </>
  );
}

export default CronParser;
