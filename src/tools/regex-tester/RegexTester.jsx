import React from 'react';
import { Clipboard, Sparkles } from 'lucide-react';

const SAMPLE_PATTERN = String.raw`(?<level>INFO|WARN|ERROR)\s+\[(?<module>[^\]]+)\]\s+(?<message>.+)`;

const SAMPLE_TEXT = `INFO [api] request success user=10001
WARN [job] retry task partition=20260620
ERROR [sync] write failed code=500`;

const FLAG_OPTIONS = [
  { key: 'g', label: '全局 g' },
  { key: 'i', label: '忽略大小写 i' },
  { key: 'm', label: '多行 m' },
  { key: 's', label: '点匹配换行 s' },
  { key: 'u', label: 'Unicode u' },
  { key: 'y', label: '粘连 y' },
];

function selectedFlags(flags) {
  return FLAG_OPTIONS.filter((item) => flags[item.key]).map((item) => item.key).join('');
}

function scanFlags(flagsText) {
  const flagSet = new Set(flagsText.split(''));
  flagSet.add('g');
  return FLAG_OPTIONS.map((item) => item.key).filter((key) => flagSet.has(key)).join('');
}

function analyzeRegex(pattern, flagsText, text) {
  if (!pattern) return { error: '', matches: [] };

  try {
    const regex = new RegExp(pattern, scanFlags(flagsText));
    const matches = [];
    let match = regex.exec(text);

    while (match) {
      const start = match.index;
      const matchedText = match[0];
      const end = start + matchedText.length;
      const numberedGroups = match.slice(1).map((value, index) => ({ name: String(index + 1), value }));
      const namedGroups = Object.entries(match.groups ?? {}).map(([name, value]) => ({ name, value }));

      matches.push({
        index: matches.length + 1,
        start,
        end,
        text: matchedText,
        groups: [...numberedGroups, ...namedGroups],
      });

      if (matchedText.length === 0) regex.lastIndex += 1;
      match = regex.exec(text);
    }

    return { error: '', matches };
  } catch (error) {
    return { error: error instanceof Error ? error.message : '正则表达式无效', matches: [] };
  }
}

function renderHighlightedText(text, matches) {
  if (!text) return <span className="empty-result">请输入样本文本后查看高亮结果。</span>;
  if (!matches.length) return text;

  const parts = [];
  let cursor = 0;

  matches.forEach((match) => {
    if (match.start < cursor) return;
    if (match.start > cursor) parts.push(text.slice(cursor, match.start));

    parts.push(
      <mark className={`regex-match-highlight ${match.start === match.end ? 'is-zero-length' : ''}`} key={`${match.start}-${match.end}-${match.index}`}>
        {match.start === match.end ? '∅' : text.slice(match.start, match.end)}
      </mark>,
    );
    cursor = match.end;
  });

  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function formatMatch(match) {
  const groups = match.groups
    .map((group) => `${group.name}=${group.value ?? 'undefined'}`)
    .join(', ');

  return `#${match.index} [${match.start}, ${match.end}) ${JSON.stringify(match.text)}${groups ? ` | ${groups}` : ''}`;
}

function RegexTester() {
  const [pattern, setPattern] = React.useState(SAMPLE_PATTERN);
  const [text, setText] = React.useState(SAMPLE_TEXT);
  const [flags, setFlags] = React.useState({ g: true, i: false, m: true, s: false, u: false, y: false });
  const [copyText, setCopyText] = React.useState('复制匹配');

  const flagsText = React.useMemo(() => selectedFlags(flags), [flags]);
  const result = React.useMemo(() => analyzeRegex(pattern, flagsText, text), [flagsText, pattern, text]);
  const firstMatch = result.matches[0];

  const setFlag = (key, checked) => {
    setFlags((currentFlags) => ({ ...currentFlags, [key]: checked }));
  };

  const loadSample = () => {
    setPattern(SAMPLE_PATTERN);
    setText(SAMPLE_TEXT);
    setFlags({ g: true, i: false, m: true, s: false, u: false, y: false });
  };

  const copyMatches = async () => {
    const output = result.matches.length
      ? result.matches.map(formatMatch).join('\n')
      : '未匹配到结果';

    await navigator.clipboard.writeText(output);
    setCopyText('已复制');
    setTimeout(() => setCopyText('复制匹配'), 1400);
  };

  return (
    <>
      <section className="workspace-grid regex-workspace utility-workspace">
        <article className="panel ddl-config-panel">
          <div className="panel-header">
            <h2>正则测试器</h2>
            <div className="panel-tools">
              <button type="button" className="ghost" onClick={loadSample}><Sparkles size={15} />示例</button>
              <button type="button" className="ghost danger" onClick={() => setText('')}>清空文本</button>
            </div>
          </div>

          <div className="ddl-form-scroll">
            <section className="ddl-section">
              <h3>表达式</h3>
              <div className="ddl-form-grid">
                <label className="setting-field ddl-field-wide">
                  <span>Pattern</span>
                  <input value={pattern} onChange={(event) => setPattern(event.target.value)} placeholder="输入 JavaScript 正则表达式，不需要包裹 / /" spellCheck="false" />
                </label>
              </div>
              <div className="regex-flag-grid" aria-label="正则 flags">
                {FLAG_OPTIONS.map((item) => (
                  <label className="setting-check ddl-check-card" key={item.key}>
                    <input type="checkbox" checked={flags[item.key]} onChange={(event) => setFlag(item.key, event.target.checked)} />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
              <p className="utility-hint">当前表达式：/{pattern || '空表达式'}/{flagsText}</p>
              {result.error && <p className="error-message">{result.error}</p>}
            </section>

            <section className="ddl-section">
              <h3>样本文本</h3>
              <textarea className="utility-textarea regex-sample-input" value={text} onChange={(event) => setText(event.target.value)} spellCheck="false" />
            </section>
          </div>
        </article>

        <article className="panel output-panel">
          <div className="panel-header">
            <h2>匹配结果</h2>
            <div className="panel-tools">
              <button type="button" onClick={copyMatches} disabled={Boolean(result.error)}><Clipboard size={15} />{copyText}</button>
            </div>
          </div>

          <div className="formatted-result regex-result" aria-label="正则匹配高亮结果">
            {result.error ? (
              <p className="empty-result">请修正正则表达式后查看匹配结果。</p>
            ) : (
              <>
                <pre className="regex-highlight-view">{renderHighlightedText(text, result.matches)}</pre>
                <div className="regex-match-list">
                  {result.matches.length === 0 ? (
                    <p className="empty-result">未匹配到结果。</p>
                  ) : result.matches.map((match) => (
                    <section className="regex-match-card" key={`${match.start}-${match.end}-${match.index}`}>
                      <div className="regex-match-card-header">
                        <strong>#{match.index}</strong>
                        <span>[{match.start}, {match.end})</span>
                      </div>
                      <code>{match.text || '零宽匹配'}</code>
                      {match.groups.length > 0 && (
                        <div className="regex-group-list">
                          {match.groups.map((group) => (
                            <span key={`${match.index}-${group.name}`}>{group.name}: {group.value ?? 'undefined'}</span>
                          ))}
                        </div>
                      )}
                    </section>
                  ))}
                </div>
              </>
            )}
          </div>
        </article>
      </section>

      <div className="compact-stats" aria-label="正则匹配统计信息">
        <span>{result.error ? '表达式无效' : `${result.matches.length} 个匹配`}</span>
        <span>{firstMatch ? `首个位置 ${firstMatch.start}` : '暂无匹配'}</span>
        <span>/{flagsText || '无 flags'}</span>
      </div>
    </>
  );
}

export default RegexTester;
