import React from 'react';
import { Clipboard } from 'lucide-react';

const DIRECTIONS = [
  { id: 'hiveToCh', name: 'Hive → ClickHouse' },
  { id: 'chToHive', name: 'ClickHouse → Hive' },
];

const SAMPLE_HIVE = `id bigint COMMENT '主键 ID',
user_id string COMMENT '用户 ID',
event_time timestamp COMMENT '事件时间',
amount decimal(18, 2) COMMENT '金额',
is_active boolean COMMENT '是否活跃'`;

const SAMPLE_CH = `id Int64 COMMENT '主键 ID',
user_id String COMMENT '用户 ID',
event_time DateTime COMMENT '事件时间',
amount Decimal(18, 2) COMMENT '金额',
is_active Bool COMMENT '是否活跃'`;

const HIVE_TO_CH = {
  string: 'String', varchar: 'String', char: 'String', bigint: 'Int64', int: 'Int32', integer: 'Int32',
  smallint: 'Int16', tinyint: 'Int8', double: 'Float64', float: 'Float32', boolean: 'Bool', bool: 'Bool',
  timestamp: 'DateTime', date: 'Date', binary: 'String',
};

const CH_TO_HIVE = {
  string: 'string', fixedstring: 'string', bool: 'boolean', boolean: 'boolean', int8: 'tinyint', int16: 'smallint',
  int32: 'int', int64: 'bigint', uint8: 'smallint', uint16: 'int', uint32: 'bigint', uint64: 'decimal(20, 0)',
  float32: 'float', float64: 'double', date: 'date', datetime: 'timestamp', datetime64: 'timestamp',
};

const TYPE_ROWS = [
  ['string / varchar / char', 'String'],
  ['bigint / int / smallint / tinyint', 'Int64 / Int32 / Int16 / Int8'],
  ['double / float', 'Float64 / Float32'],
  ['decimal(p, s)', 'Decimal(p, s)'],
  ['boolean', 'Bool'],
  ['timestamp / date', 'DateTime / Date'],
  ['array<T> / map<K,V>', 'Array(T) / Map(K,V)'],
];

function cleanType(type) {
  return type.trim().replace(/,$/, '').replace(/\s+not\s+null$/i, '').replace(/\s+null$/i, '').trim();
}

function splitTopLevel(value) {
  const parts = [];
  let current = '';
  let angle = 0;
  let paren = 0;

  for (const char of value) {
    if (char === '<') angle += 1;
    if (char === '>') angle = Math.max(0, angle - 1);
    if (char === '(') paren += 1;
    if (char === ')') paren = Math.max(0, paren - 1);

    if (char === ',' && angle === 0 && paren === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function hiveGeneric(type, name) {
  const match = type.match(new RegExp(`^${name}\\s*<([\\s\\S]+)>$`, 'i'));
  return match ? match[1].trim() : '';
}

function chFunc(type, name) {
  const match = type.match(new RegExp(`^${name}\\s*\\(([\\s\\S]+)\\)$`, 'i'));
  return match ? match[1].trim() : '';
}

function hiveToCh(type, nullable = false) {
  const source = cleanType(type);
  const lower = source.toLowerCase();
  const decimal = source.match(/^decimal\s*\(([\s\S]+)\)$/i);
  const arrayInner = hiveGeneric(source, 'array');
  const mapInner = hiveGeneric(source, 'map');
  let result = HIVE_TO_CH[lower] ?? source;

  if (decimal) result = `Decimal(${decimal[1].trim()})`;
  else if (/^(varchar|char)\s*\(\s*\d+\s*\)$/i.test(source)) result = 'String';
  else if (arrayInner) result = `Array(${hiveToCh(arrayInner, false)})`;
  else if (mapInner) {
    const [keyType = 'string', valueType = 'string'] = splitTopLevel(mapInner);
    result = `Map(${hiveToCh(keyType, false)}, ${hiveToCh(valueType, false)})`;
  }

  if (!nullable || /^(Array|Map|Tuple|Nullable)\s*\(/i.test(result)) return result;
  return `Nullable(${result})`;
}

function unwrapCh(type) {
  let result = cleanType(type);
  let changed = true;

  while (changed) {
    changed = false;
    const nullableInner = chFunc(result, 'Nullable');
    const lowCardinalityInner = chFunc(result, 'LowCardinality');

    if (nullableInner) {
      result = nullableInner;
      changed = true;
    } else if (lowCardinalityInner) {
      result = lowCardinalityInner;
      changed = true;
    }
  }

  return result;
}

function chToHive(type) {
  const source = unwrapCh(type);
  const lower = source.toLowerCase();
  const decimal = source.match(/^Decimal\s*\(([\s\S]+)\)$/i);
  const arrayInner = chFunc(source, 'Array');
  const mapInner = chFunc(source, 'Map');

  if (decimal) return `decimal(${decimal[1].trim()})`;
  if (/^DateTime64\s*\(/i.test(source)) return 'timestamp';
  if (/^FixedString\s*\(/i.test(source)) return 'string';
  if (arrayInner) return `array<${chToHive(arrayInner)}>`;
  if (mapInner) {
    const [keyType = 'String', valueType = 'String'] = splitTopLevel(mapInner);
    return `map<${chToHive(keyType)}, ${chToHive(valueType)}>`;
  }

  return CH_TO_HIVE[lower] ?? source.toLowerCase();
}

function parseLine(line) {
  const cleanLine = line.trim().replace(/,$/, '').trim();
  if (!cleanLine || cleanLine.startsWith('--')) return null;

  const commentMatch = cleanLine.match(/\s+COMMENT\s+('([^']*)'|"([^"]*)")\s*$/i);
  const text = commentMatch ? cleanLine.slice(0, commentMatch.index).trim() : cleanLine;
  const comment = commentMatch ? commentMatch[2] ?? commentMatch[3] ?? '' : '';
  const match = text.match(/^(`[^`]+`|"[^"]+"|[A-Za-z_][\w.$]*)\s+([\s\S]+)$/);

  return match ? { name: match[1], type: match[2].trim(), comment } : { name: '', type: text, comment: '' };
}

function convertLine(line, direction, nullable, keepComments) {
  const parsed = parseLine(line);
  if (!parsed) return '';

  const convertedType = direction === 'hiveToCh' ? hiveToCh(parsed.type, nullable) : chToHive(parsed.type);
  const comment = keepComments && parsed.comment ? ` COMMENT '${parsed.comment.replaceAll("'", "\\'")}'` : '';

  return parsed.name ? `${parsed.name} ${convertedType}${comment}` : convertedType;
}

function TypeConverter() {
  const [direction, setDirection] = React.useState('hiveToCh');
  const [input, setInput] = React.useState(SAMPLE_HIVE);
  const [quickType, setQuickType] = React.useState('array<string>');
  const [nullable, setNullable] = React.useState(false);
  const [keepComments, setKeepComments] = React.useState(true);
  const [copyText, setCopyText] = React.useState('复制结果');

  const output = React.useMemo(() => input
    .split('\n')
    .map((line) => convertLine(line, direction, nullable, keepComments))
    .filter(Boolean)
    .join('\n'), [direction, input, keepComments, nullable]);
  const quickResult = React.useMemo(() => quickType.trim()
    ? direction === 'hiveToCh' ? hiveToCh(quickType, nullable) : chToHive(quickType)
    : '', [direction, nullable, quickType]);

  const loadSample = () => {
    setInput(direction === 'hiveToCh' ? SAMPLE_HIVE : SAMPLE_CH);
    setQuickType(direction === 'hiveToCh' ? 'array<string>' : 'Array(String)');
  };

  const copyResult = async () => {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopyText('已复制');
    setTimeout(() => setCopyText('复制结果'), 1400);
  };

  return (
    <>
      <section className="workspace-grid ddl-workspace converter-workspace">
        <article className="panel ddl-config-panel">
          <div className="panel-header">
            <h2>类型转换配置</h2>
            <span>Hive / ClickHouse</span>
          </div>
          <div className="ddl-form-scroll">
            <div className="ddl-type-tabs converter-direction-tabs" role="tablist" aria-label="转换方向">
              {DIRECTIONS.map((item) => (
                <button key={item.id} type="button" role="tab" className={direction === item.id ? 'is-active' : ''} aria-selected={direction === item.id} onClick={() => setDirection(item.id)}>
                  {item.name}
                </button>
              ))}
            </div>

            <section className="ddl-section">
              <h3>单类型转换</h3>
              <div className="ddl-form-grid">
                <label className="setting-field">
                  <span>源类型</span>
                  <input value={quickType} onChange={(event) => setQuickType(event.target.value)} placeholder="string / Nullable(Int64)" />
                </label>
                <label className="setting-field">
                  <span>转换结果</span>
                  <input value={quickResult} readOnly />
                </label>
                {direction === 'hiveToCh' && (
                  <label className="setting-check ddl-check-card ddl-field-wide">
                    <input type="checkbox" checked={nullable} onChange={(event) => setNullable(event.target.checked)} />
                    <span>普通类型包裹 Nullable</span>
                  </label>
                )}
                <label className="setting-check ddl-check-card ddl-field-wide">
                  <input type="checkbox" checked={keepComments} onChange={(event) => setKeepComments(event.target.checked)} />
                  <span>批量转换保留字段注释</span>
                </label>
              </div>
            </section>

            <section className="ddl-section">
              <div className="ddl-section-title-row">
                <h3>字段列表</h3>
                <button type="button" className="ghost" onClick={loadSample}>示例</button>
              </div>
              <textarea className="converter-input" value={input} onChange={(event) => setInput(event.target.value)} spellCheck="false" />
            </section>

            <section className="ddl-section">
              <h3>常用映射</h3>
              <div className="type-map-list">
                {TYPE_ROWS.map(([hive, clickhouse]) => (
                  <div className="type-map-row" key={hive}>
                    <strong>{direction === 'hiveToCh' ? hive : clickhouse}</strong>
                    <span>{direction === 'hiveToCh' ? clickhouse : hive}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </article>

        <article className="panel output-panel">
          <div className="panel-header">
            <h2>转换结果</h2>
            <div className="panel-tools">
              <button type="button" onClick={copyResult} disabled={!output}><Clipboard size={15} />{copyText}</button>
            </div>
          </div>
          <pre className="formatted-result sql-result ddl-result">{output || '请输入字段或类型后查看转换结果。'}</pre>
        </article>
      </section>

      <div className="compact-stats" aria-label="类型转换统计信息">
        <span>{DIRECTIONS.find((item) => item.id === direction)?.name}</span>
        <span>{output.split('\n').filter((line) => line.trim()).length} 行结果</span>
      </div>
    </>
  );
}

export default TypeConverter;
