import React from 'react';
import { Clipboard, Download, Sparkles } from 'lucide-react';

const SAMPLE_LEFT = `{
  "app": "mini-tools",
  "version": 1,
  "features": ["json", "sql", "ddl"],
  "owner": "data_dev"
}`;

const SAMPLE_RIGHT = `{
  "app": "mini-tools",
  "version": 2,
  "features": ["json", "sql", "ddl", "diff"],
  "owner": "data_platform"
}`;

function sortJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== 'object') return value;

  return Object.keys(value)
    .sort((leftKey, rightKey) => leftKey.localeCompare(rightKey))
    .reduce((result, key) => ({ ...result, [key]: sortJsonValue(value[key]) }), {});
}

function prepareText(text, normalizeJson) {
  if (!normalizeJson || !text.trim()) return { text, error: '' };

  try {
    return { text: JSON.stringify(sortJsonValue(JSON.parse(text)), null, 2), error: '' };
  } catch (error) {
    return { text, error: error instanceof Error ? error.message : 'JSON 标准化失败' };
  }
}

function normalizeLine(line, options) {
  let result = options.trimLines ? line.trim() : line;

  if (options.ignoreWhitespace) result = result.replace(/\s+/g, ' ');
  if (options.ignoreCase) result = result.toLowerCase();

  return result;
}

function buildPairwiseDiff(leftLines, rightLines, leftKeys, rightKeys) {
  const rows = [];
  const maxLength = Math.max(leftLines.length, rightLines.length);

  for (let index = 0; index < maxLength; index += 1) {
    const hasLeft = index < leftLines.length;
    const hasRight = index < rightLines.length;

    if (hasLeft && hasRight && leftKeys[index] === rightKeys[index]) {
      rows.push({ type: 'same', leftNo: index + 1, rightNo: index + 1, leftText: leftLines[index], rightText: rightLines[index] });
    } else if (hasLeft && hasRight) {
      rows.push({ type: 'change', leftNo: index + 1, rightNo: index + 1, leftText: leftLines[index], rightText: rightLines[index] });
    } else if (hasLeft) {
      rows.push({ type: 'remove', leftNo: index + 1, rightNo: '', leftText: leftLines[index], rightText: '' });
    } else {
      rows.push({ type: 'add', leftNo: '', rightNo: index + 1, leftText: '', rightText: rightLines[index] });
    }
  }

  return rows;
}

function buildLineDiff(leftText, rightText, options) {
  const leftLines = leftText.split('\n');
  const rightLines = rightText.split('\n');
  const leftKeys = leftLines.map((line) => normalizeLine(line, options));
  const rightKeys = rightLines.map((line) => normalizeLine(line, options));

  if (leftKeys.length * rightKeys.length > 250000) {
    return buildPairwiseDiff(leftLines, rightLines, leftKeys, rightKeys);
  }

  const matrix = Array.from({ length: leftKeys.length + 1 }, () => Array(rightKeys.length + 1).fill(0));

  for (let leftIndex = leftKeys.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = rightKeys.length - 1; rightIndex >= 0; rightIndex -= 1) {
      matrix[leftIndex][rightIndex] = leftKeys[leftIndex] === rightKeys[rightIndex]
        ? matrix[leftIndex + 1][rightIndex + 1] + 1
        : Math.max(matrix[leftIndex + 1][rightIndex], matrix[leftIndex][rightIndex + 1]);
    }
  }

  const operations = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < leftLines.length || rightIndex < rightLines.length) {
    if (leftIndex < leftLines.length && rightIndex < rightLines.length && leftKeys[leftIndex] === rightKeys[rightIndex]) {
      operations.push({ type: 'same', leftNo: leftIndex + 1, rightNo: rightIndex + 1, leftText: leftLines[leftIndex], rightText: rightLines[rightIndex] });
      leftIndex += 1;
      rightIndex += 1;
    } else if (rightIndex < rightLines.length && (leftIndex === leftLines.length || matrix[leftIndex][rightIndex + 1] >= matrix[leftIndex + 1][rightIndex])) {
      operations.push({ type: 'add', leftNo: '', rightNo: rightIndex + 1, leftText: '', rightText: rightLines[rightIndex] });
      rightIndex += 1;
    } else {
      operations.push({ type: 'remove', leftNo: leftIndex + 1, rightNo: '', leftText: leftLines[leftIndex], rightText: '' });
      leftIndex += 1;
    }
  }

  const rows = [];

  for (let index = 0; index < operations.length; index += 1) {
    const current = operations[index];
    const next = operations[index + 1];

    if (current.type === 'remove' && next?.type === 'add') {
      rows.push({ type: 'change', leftNo: current.leftNo, rightNo: next.rightNo, leftText: current.leftText, rightText: next.rightText });
      index += 1;
    } else if (current.type === 'add' && next?.type === 'remove') {
      rows.push({ type: 'change', leftNo: next.leftNo, rightNo: current.rightNo, leftText: next.leftText, rightText: current.rightText });
      index += 1;
    } else {
      rows.push(current);
    }
  }

  return rows;
}

function buildUnifiedDiff(rows) {
  return [
    '--- 原始文本',
    '+++ 对比文本',
    ...rows.flatMap((row) => {
      if (row.type === 'same') return [`  ${row.leftText}`];
      if (row.type === 'add') return [`+ ${row.rightText}`];
      if (row.type === 'remove') return [`- ${row.leftText}`];
      return [`- ${row.leftText}`, `+ ${row.rightText}`];
    }),
  ].join('\n');
}

function getStats(rows) {
  return rows.reduce((stats, row) => ({
    same: stats.same + (row.type === 'same' ? 1 : 0),
    added: stats.added + (row.type === 'add' ? 1 : 0),
    removed: stats.removed + (row.type === 'remove' ? 1 : 0),
    changed: stats.changed + (row.type === 'change' ? 1 : 0),
  }), { same: 0, added: 0, removed: 0, changed: 0 });
}

function DiffCell({ text, muted = false }) {
  return <span className={muted ? 'diff-empty-text' : undefined}>{text || (muted ? '空' : '')}</span>;
}

function TextDiffTool() {
  const [leftText, setLeftText] = React.useState(SAMPLE_LEFT);
  const [rightText, setRightText] = React.useState(SAMPLE_RIGHT);
  const [options, setOptions] = React.useState({
    trimLines: false,
    ignoreWhitespace: false,
    ignoreCase: false,
    normalizeJson: true,
  });
  const [copyText, setCopyText] = React.useState('复制 Diff');

  const preparedLeft = React.useMemo(() => prepareText(leftText, options.normalizeJson), [leftText, options.normalizeJson]);
  const preparedRight = React.useMemo(() => prepareText(rightText, options.normalizeJson), [rightText, options.normalizeJson]);
  const rows = React.useMemo(() => buildLineDiff(preparedLeft.text, preparedRight.text, options), [options, preparedLeft.text, preparedRight.text]);
  const unifiedDiff = React.useMemo(() => buildUnifiedDiff(rows), [rows]);
  const stats = React.useMemo(() => getStats(rows), [rows]);
  const jsonWarning = options.normalizeJson && (preparedLeft.error || preparedRight.error);

  const setOption = (key, value) => {
    setOptions((currentOptions) => ({ ...currentOptions, [key]: value }));
  };

  const loadSample = () => {
    setLeftText(SAMPLE_LEFT);
    setRightText(SAMPLE_RIGHT);
  };

  const clearText = () => {
    setLeftText('');
    setRightText('');
  };

  const copyDiff = async () => {
    await navigator.clipboard.writeText(unifiedDiff);
    setCopyText('已复制');
    setTimeout(() => setCopyText('复制 Diff'), 1400);
  };

  const downloadDiff = () => {
    const blob = new Blob([unifiedDiff], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'text.diff';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <section className="workspace-grid diff-workspace utility-workspace">
        <article className="panel ddl-config-panel">
          <div className="panel-header">
            <h2>文本 Diff 配置</h2>
            <div className="panel-tools">
              <button type="button" className="ghost" onClick={loadSample}><Sparkles size={15} />示例</button>
              <button type="button" className="ghost danger" onClick={clearText}>清空</button>
            </div>
          </div>

          <div className="ddl-form-scroll">
            <section className="ddl-section">
              <h3>对比选项</h3>
              <div className="utility-option-grid">
                <label className="setting-check ddl-check-card">
                  <input type="checkbox" checked={options.normalizeJson} onChange={(event) => setOption('normalizeJson', event.target.checked)} />
                  <span>JSON 排序并格式化后对比</span>
                </label>
                <label className="setting-check ddl-check-card">
                  <input type="checkbox" checked={options.trimLines} onChange={(event) => setOption('trimLines', event.target.checked)} />
                  <span>忽略行首行尾空格</span>
                </label>
                <label className="setting-check ddl-check-card">
                  <input type="checkbox" checked={options.ignoreWhitespace} onChange={(event) => setOption('ignoreWhitespace', event.target.checked)} />
                  <span>压缩连续空白后对比</span>
                </label>
                <label className="setting-check ddl-check-card">
                  <input type="checkbox" checked={options.ignoreCase} onChange={(event) => setOption('ignoreCase', event.target.checked)} />
                  <span>忽略大小写</span>
                </label>
              </div>
              {jsonWarning && <p className="utility-warning">JSON 标准化失败，已按原始文本对比：{preparedLeft.error || preparedRight.error}</p>}
            </section>

            <section className="ddl-section diff-input-section">
              <h3>输入文本</h3>
              <div className="diff-input-grid">
                <label className="setting-field">
                  <span>原始文本</span>
                  <textarea className="utility-textarea diff-textarea" value={leftText} onChange={(event) => setLeftText(event.target.value)} spellCheck="false" />
                </label>
                <label className="setting-field">
                  <span>对比文本</span>
                  <textarea className="utility-textarea diff-textarea" value={rightText} onChange={(event) => setRightText(event.target.value)} spellCheck="false" />
                </label>
              </div>
            </section>
          </div>
        </article>

        <article className="panel output-panel">
          <div className="panel-header">
            <h2>行级差异</h2>
            <div className="panel-tools">
              <button type="button" onClick={copyDiff}><Clipboard size={15} />{copyText}</button>
              <button type="button" onClick={downloadDiff}><Download size={15} />下载</button>
            </div>
          </div>
          <div className="formatted-result diff-result" aria-label="文本差异结果">
            <div className="diff-table">
              <div className="diff-row diff-head">
                <span>原行</span>
                <span>原始文本</span>
                <span>新行</span>
                <span>对比文本</span>
              </div>
              {rows.map((row, index) => (
                <div className={`diff-row diff-row-${row.type}`} key={`${row.leftNo}-${row.rightNo}-${index}`}>
                  <span className="diff-line-no">{row.leftNo}</span>
                  <span className="diff-cell"><DiffCell text={row.leftText} muted={!row.leftText && row.type !== 'same'} /></span>
                  <span className="diff-line-no">{row.rightNo}</span>
                  <span className="diff-cell"><DiffCell text={row.rightText} muted={!row.rightText && row.type !== 'same'} /></span>
                </div>
              ))}
            </div>
          </div>
        </article>
      </section>

      <div className="compact-stats" aria-label="文本 Diff 统计信息">
        <span>{stats.same} 行相同</span>
        <span>{stats.changed} 行修改</span>
        <span>{stats.added} 行新增</span>
        <span>{stats.removed} 行删除</span>
      </div>
    </>
  );
}

export default TextDiffTool;
