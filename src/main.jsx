import React from 'react';
import { createRoot } from 'react-dom/client';
import { CheckCircle2, ChevronDown, ChevronRight, Clipboard, Download, FileJson2, Minimize2, Settings, Sparkles, XCircle } from 'lucide-react';
import { formatSQL, defaultOptions as defaultSqlOptions } from './sqlFormatter';
import './styles.css';

const SAMPLE_JSON = `{
  "project": "mini-tools",
  "tool": "JSON 解析工具",
  "features": ["彩色格式化", "节点折叠", "复制路径", "复制值"],
  "enabled": true,
  "version": 1,
  "metadata": {
    "author": "kelywang",
    "theme": "dark-viewer"
  }
}`;

const SAMPLE_SQL = `select 2 as log_type, 1 as log_from, app_id as app_id, coalesce(svr, '') as svr, get_json_object(recv_bon, '$.Info4A.DataSource.ullCreateTimestampMs') as create_time, from_unixtime(cast(get_json_object(recv_bon, '$.Info4A.DataSource.ullCreateTimestampMs') as bigint) / 1000, 'yyyyMMdd') as dt from my_table where dt >= '20260201' and dt < '20260301' and subtype in (71785, 71790)`;

const JSON_INDENT = 32;

const THEMES = [
  { id: 'midnight', name: '暗夜紫', description: '接近 JSON Viewer Pro 的深色风格' },
  { id: 'ocean', name: '深海蓝', description: '蓝绿色高亮，适合长时间阅读' },
  { id: 'light', name: '简约浅色', description: '浅色背景，适合白天使用' },
];

const TOOL_OPTIONS = [
  { id: 'json', name: 'JSON 解析工具', shortName: 'JSON' },
  { id: 'sql', name: 'SQL 格式化工具', shortName: 'SQL' },
];

function parseJson(input) {
  try {
    return { value: JSON.parse(input), error: '' };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : 'JSON 解析失败' };
  }
}

function getType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function stringifyNodeValue(value) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function buildPath(parentPath, key, parentType) {
  if (parentType === 'array') return `${parentPath}[${key}]`;

  const keyText = String(key);
  if (/^[A-Za-z_$][\w$]*$/.test(keyText)) {
    return parentPath ? `${parentPath}.${keyText}` : keyText;
  }

  return parentPath ? `${parentPath}[${JSON.stringify(keyText)}]` : `[${JSON.stringify(keyText)}]`;
}

function JsonStringLiteral({ value, className = 'json-string' }) {
  return <span className={className}>{JSON.stringify(value)}</span>;
}

function JsonPrimitive({ value }) {
  const type = getType(value);

  if (type === 'string') return <JsonStringLiteral value={value} />;
  if (type === 'null') return <span className="json-null">null</span>;
  return <span className={`json-${type}`}>{String(value)}</span>;
}

function JsonLine({ level, className = '', children }) {
  return (
    <div
      className={['json-line', className].filter(Boolean).join(' ')}
      style={{ paddingLeft: `${level * JSON_INDENT}px` }}
    >
      {children}
    </div>
  );
}

function JsonCollectionFrame({ level, collapsed, children }) {
  return (
    <div
      className={`json-collection ${collapsed ? 'is-collapsed' : 'has-guide'}`}
      style={{ '--branch-left': `${(level + 1) * JSON_INDENT - 14}px` }}
    >
      {children}
    </div>
  );
}

function JsonCopyMenu({ path, value, copiedTarget, onCopyNode }) {
  const [open, setOpen] = React.useState(false);
  const displayPath = path || '$';
  const pathCopied = copiedTarget === `path:${displayPath}`;
  const valueCopied = copiedTarget === `value:${displayPath}`;

  const handleCopy = async (event, copyType) => {
    event.preventDefault();
    event.stopPropagation();
    await onCopyNode(copyType, displayPath, value);
    setOpen(false);
  };

  return (
    <span className={`json-node-actions ${open ? 'is-open' : ''}`} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="json-action-trigger"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((currentOpen) => !currentOpen);
        }}
        title="复制路径或复制值"
        aria-label={`打开节点 ${displayPath} 的复制菜单`}
      >
        <Clipboard size={13} />
      </button>
      <span className="json-copy-menu" role="menu">
        <button type="button" role="menuitem" onPointerDown={(event) => handleCopy(event, 'path')}>
          {pathCopied ? '已复制路径' : '复制路径'}
        </button>
        <button type="button" role="menuitem" onPointerDown={(event) => handleCopy(event, 'value')}>
          {valueCopied ? '已复制值' : '复制值'}
        </button>
      </span>
    </span>
  );
}

function JsonKeyLabel({ name }) {
  return (
    <>
      <span className="json-key-token"><JsonStringLiteral value={name} className="json-key" /></span>
      <span className="json-punctuation">: </span>
    </>
  );
}

function JsonFoldButton({ collapsed, path, onToggleCollapse }) {
  const displayPath = path || '$';

  return (
    <button
      type="button"
      className="json-fold-button"
      onClick={() => onToggleCollapse(displayPath)}
      title={collapsed ? '展开节点' : '折叠节点'}
      aria-label={`${collapsed ? '展开' : '折叠'}节点 ${displayPath}`}
      aria-expanded={!collapsed}
    >
      {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
    </button>
  );
}

function JsonCollectionSummary({ type, entries }) {
  return (
    <span className="json-summary">
      {type === 'array' ? `${entries.length} items` : `${entries.length} keys`}
    </span>
  );
}

function JsonSyntaxNode({ data, propertyName, path = '', level = 0, isLast = true, copiedTarget, collapsedPaths, onToggleCollapse, onCopyNode }) {
  const type = getType(data);
  const isCollection = type === 'array' || type === 'object';
  const entries = type === 'array'
    ? data.map((item, index) => [index, item])
    : type === 'object'
      ? Object.entries(data)
      : [];
  const openToken = type === 'array' ? '[' : '{';
  const closeToken = type === 'array' ? ']' : '}';
  const collapsePath = path || '$';
  const collapsed = collapsedPaths.has(collapsePath);
  const keyLabel = propertyName !== undefined ? <JsonKeyLabel name={propertyName} /> : null;
  const copyMenu = <JsonCopyMenu path={path} value={data} copiedTarget={copiedTarget} onCopyNode={onCopyNode} />;

  if (!isCollection) {
    return (
      <JsonLine level={level}>
        <span className="json-fold-spacer" />
        {keyLabel}
        <JsonPrimitive value={data} />
        {!isLast && <span className="json-punctuation">,</span>}
        {copyMenu}
      </JsonLine>
    );
  }

  if (entries.length === 0) {
    return (
      <JsonLine level={level}>
        <span className="json-fold-spacer" />
        {keyLabel}
        <span className="json-punctuation">{openToken}{closeToken}</span>
        {!isLast && <span className="json-punctuation">,</span>}
        {copyMenu}
      </JsonLine>
    );
  }

  return (
    <JsonCollectionFrame level={level} collapsed={collapsed}>
      <JsonLine level={level} className={collapsed ? 'is-collapsed' : ''}>
        <JsonFoldButton collapsed={collapsed} path={path} onToggleCollapse={onToggleCollapse} />
        {keyLabel}
        <span className="json-punctuation">{openToken}</span>
        {collapsed && (
          <>
            <span className="json-ellipsis">…</span>
            <JsonCollectionSummary type={type} entries={entries} />
            <span className="json-punctuation">{closeToken}</span>
            {!isLast && <span className="json-punctuation">,</span>}
          </>
        )}
        {copyMenu}
      </JsonLine>
      {!collapsed && entries.map(([key, item], index) => {
        const childPath = buildPath(path, key, type);
        return (
          <JsonSyntaxNode
            key={childPath}
            data={item}
            propertyName={type === 'object' ? key : undefined}
            path={childPath}
            level={level + 1}
            isLast={index === entries.length - 1}
            copiedTarget={copiedTarget}
            collapsedPaths={collapsedPaths}
            onToggleCollapse={onToggleCollapse}
            onCopyNode={onCopyNode}
          />
        );
      })}
      {!collapsed && (
        <JsonLine level={level}>
          <span className="json-fold-spacer" />
          <span className="json-punctuation">{closeToken}</span>
          {!isLast && <span className="json-punctuation">,</span>}
        </JsonLine>
      )}
    </JsonCollectionFrame>
  );
}

function JsonSyntaxView({ data, copiedTarget, onCopyNode }) {
  const [collapsedPaths, setCollapsedPaths] = React.useState(() => new Set());

  const toggleCollapse = React.useCallback((nodePath) => {
    setCollapsedPaths((currentPaths) => {
      const nextPaths = new Set(currentPaths);

      if (nextPaths.has(nodePath)) {
        nextPaths.delete(nodePath);
      } else {
        nextPaths.add(nodePath);
      }

      return nextPaths;
    });
  }, []);

  React.useEffect(() => {
    setCollapsedPaths(new Set());
  }, [data]);

  return (
    <div className="json-view" role="tree" aria-label="彩色格式化 JSON 结果">
      <JsonSyntaxNode
        data={data}
        copiedTarget={copiedTarget}
        collapsedPaths={collapsedPaths}
        onToggleCollapse={toggleCollapse}
        onCopyNode={onCopyNode}
      />
    </div>
  );
}

function SettingsPanel({ open, theme, onThemeChange, activeTool, sqlOptions, onSqlOptionsChange }) {
  if (!open) return null;

  return (
    <div className="settings-panel" role="dialog" aria-label="设置">
      <div className="settings-panel-header">
        <strong>设置</strong>
        <span>{activeTool === 'sql' ? 'SQL 格式化' : '主题风格'}</span>
      </div>
      <div className="settings-section">
        <p className="settings-section-title">主题风格</p>
        <div className="theme-options">
          {THEMES.map((themeOption) => (
            <button
              key={themeOption.id}
              type="button"
              className={`theme-option ${theme === themeOption.id ? 'is-active' : ''}`}
              onClick={() => onThemeChange(themeOption.id)}
            >
              <span className={`theme-swatch theme-swatch-${themeOption.id}`} />
              <span>
                <strong>{themeOption.name}</strong>
                <small>{themeOption.description}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
      {activeTool === 'sql' && (
        <div className="settings-section">
          <p className="settings-section-title">SQL 选项</p>
          <SqlSettings options={sqlOptions} onOptionsChange={onSqlOptionsChange} />
        </div>
      )}
    </div>
  );
}

function SqlSettings({ options, onOptionsChange }) {
  const setOption = (key, value) => {
    onOptionsChange({ ...options, [key]: value });
  };

  return (
    <div className="sql-settings-grid">
      <label className="setting-field">
        <span>关键字</span>
        <select value={options.keywordCase} onChange={(event) => setOption('keywordCase', event.target.value)}>
          <option value="lowercase">小写</option>
          <option value="uppercase">大写</option>
          <option value="preserve">保持原样</option>
        </select>
      </label>
      <label className="setting-field">
        <span>逗号</span>
        <select value={options.commaPosition} onChange={(event) => setOption('commaPosition', event.target.value)}>
          <option value="leading">行首</option>
          <option value="trailing">行尾</option>
        </select>
      </label>
      <label className="setting-field">
        <span>缩进</span>
        <select value={options.indent.length} onChange={(event) => setOption('indent', ' '.repeat(Number(event.target.value)))}>
          <option value="2">2 空格</option>
          <option value="4">4 空格</option>
        </select>
      </label>
      <label className="setting-field">
        <span>别名列</span>
        <input
          type="number"
          min="20"
          max="160"
          value={options.aliasAlignColumn}
          onChange={(event) => setOption('aliasAlignColumn', Number(event.target.value) || 80)}
        />
      </label>
      <label className="setting-check">
        <input
          type="checkbox"
          checked={options.alignAliases}
          onChange={(event) => setOption('alignAliases', event.target.checked)}
        />
        <span>对齐别名</span>
      </label>
    </div>
  );
}

function ToolSwitcher({ activeTool, onToolChange }) {
  return (
    <div className="tool-switcher" role="tablist" aria-label="工具切换">
      {TOOL_OPTIONS.map((tool) => (
        <button
          key={tool.id}
          type="button"
          role="tab"
          className={activeTool === tool.id ? 'is-active' : ''}
          aria-selected={activeTool === tool.id}
          onClick={() => onToolChange(tool.id)}
        >
          {tool.shortName}
        </button>
      ))}
    </div>
  );
}

function App() {
  const [activeTool, setActiveTool] = React.useState('json');
  const [input, setInput] = React.useState(SAMPLE_JSON);
  const [sqlInput, setSqlInput] = React.useState(SAMPLE_SQL);
  const [sqlCopyText, setSqlCopyText] = React.useState('复制结果');
  const [sqlOptions, setSqlOptions] = React.useState(defaultSqlOptions);
  const [copyText, setCopyText] = React.useState('复制结果');
  const [copiedTarget, setCopiedTarget] = React.useState('');
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [theme, setTheme] = React.useState('midnight');
  const parsed = React.useMemo(() => parseJson(input), [input]);
  const prettyJson = React.useMemo(() => parsed.error ? '' : JSON.stringify(parsed.value, null, 2), [parsed]);
  const minifiedJson = React.useMemo(() => parsed.error ? '' : JSON.stringify(parsed.value), [parsed]);
  const formattedSql = React.useMemo(() => formatSQL(sqlInput, sqlOptions), [sqlInput, sqlOptions]);
  const currentTool = TOOL_OPTIONS.find((tool) => tool.id === activeTool) ?? TOOL_OPTIONS[0];

  const sqlStats = React.useMemo(() => ({
    size: sqlInput.length,
    lines: sqlInput.split('\n').length,
    outputLines: formattedSql ? formattedSql.split('\n').length : 0,
  }), [sqlInput, formattedSql]);

  const stats = React.useMemo(() => {
    if (parsed.error) return { size: input.length, lines: input.split('\n').length, nodes: 0 };

    const countNodes = (value) => {
      if (value === null || typeof value !== 'object') return 1;
      const children = Array.isArray(value) ? value : Object.values(value);
      return 1 + children.reduce((sum, item) => sum + countNodes(item), 0);
    };

    return {
      size: input.length,
      lines: input.split('\n').length,
      nodes: countNodes(parsed.value),
    };
  }, [input, parsed]);

  const setOutput = (value) => {
    if (!parsed.error) setInput(value);
  };

  const copyResult = async () => {
    if (!prettyJson) return;
    await navigator.clipboard.writeText(prettyJson);
    setCopyText('已复制');
    setTimeout(() => setCopyText('复制结果'), 1400);
  };

  const copyNode = async (copyType, nodePath, value) => {
    const text = copyType === 'path' ? nodePath : stringifyNodeValue(value);

    await navigator.clipboard.writeText(text);
    setCopiedTarget(`${copyType}:${nodePath}`);
    setTimeout(() => setCopiedTarget(''), 1400);
  };

  const downloadResult = () => {
    if (!prettyJson) return;
    const blob = new Blob([prettyJson], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'parsed.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const copySqlResult = async () => {
    if (!formattedSql) return;
    await navigator.clipboard.writeText(formattedSql);
    setSqlCopyText('已复制');
    setTimeout(() => setSqlCopyText('复制结果'), 1400);
  };

  const downloadSqlResult = () => {
    if (!formattedSql) return;
    const blob = new Blob([formattedSql], { type: 'text/sql;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'formatted.sql';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className={`app-shell theme-${theme}`}>
      <header className="top-bar">
        <div className="brand">
          <span className="brand-icon"><FileJson2 size={18} /></span>
          <span>{currentTool.name}</span>
          <ToolSwitcher activeTool={activeTool} onToolChange={setActiveTool} />
        </div>
        <div className="top-actions">
          <div className={`status-pill ${activeTool === 'json' && parsed.error ? 'error' : 'success'}`}>
            {activeTool === 'json' && parsed.error ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
            {activeTool === 'json' ? (parsed.error ? '解析失败' : 'JSON 有效') : 'SQL 可格式化'}
          </div>
          <button
            type="button"
            className="icon-button settings-button"
            onClick={() => setSettingsOpen((currentOpen) => !currentOpen)}
            aria-label="打开设置"
            aria-expanded={settingsOpen}
          >
            <Settings size={18} />
          </button>
          <SettingsPanel
            open={settingsOpen}
            theme={theme}
            onThemeChange={setTheme}
            activeTool={activeTool}
            sqlOptions={sqlOptions}
            onSqlOptionsChange={setSqlOptions}
          />
        </div>
      </header>

      {activeTool === 'json' ? (
        <>
          <section className="workspace-grid json-workspace">
            <article className="panel editor-panel">
              <div className="panel-header">
                <h2>输入 JSON</h2>
                <div className="panel-tools">
                  <button onClick={() => setOutput(prettyJson)} disabled={Boolean(parsed.error)}><Sparkles size={15} />格式化</button>
                  <button onClick={() => setOutput(minifiedJson)} disabled={Boolean(parsed.error)}><Minimize2 size={15} />压缩</button>
                  <button onClick={copyResult} disabled={Boolean(parsed.error)}><Clipboard size={15} />{copyText}</button>
                  <button onClick={downloadResult} disabled={Boolean(parsed.error)}><Download size={15} />下载</button>
                  <button className="ghost" onClick={() => setInput(SAMPLE_JSON)}>示例</button>
                  <button className="ghost danger" onClick={() => setInput('')}>清空</button>
                </div>
              </div>
              <textarea value={input} onChange={(event) => setInput(event.target.value)} spellCheck="false" />
              {parsed.error && <p className="error-message">{parsed.error}</p>}
            </article>

            <article className="panel output-panel">
              <div className="panel-header">
                <h2>格式化结果</h2>
                <span>悬停节点 · 复制路径 / 复制值</span>
              </div>
              <div className="formatted-result">
                {parsed.error ? (
                  <p className="empty-result">请输入合法 JSON 后查看彩色格式化结果。</p>
                ) : (
                  <JsonSyntaxView data={parsed.value} copiedTarget={copiedTarget} onCopyNode={copyNode} />
                )}
              </div>
            </article>
          </section>

          <div className="compact-stats" aria-label="JSON 统计信息">
            <span>{stats.size} 字符</span>
            <span>{stats.lines} 行</span>
            <span>{stats.nodes} 节点</span>
          </div>
        </>
      ) : (
        <>
          <section className="workspace-grid sql-workspace">
            <article className="panel editor-panel">
              <div className="panel-header">
                <h2>输入 SQL</h2>
                <div className="panel-tools">
                  <button onClick={() => setSqlInput(formattedSql)} disabled={!formattedSql}><Sparkles size={15} />格式化</button>
                  <button onClick={copySqlResult} disabled={!formattedSql}><Clipboard size={15} />{sqlCopyText}</button>
                  <button onClick={downloadSqlResult} disabled={!formattedSql}><Download size={15} />下载</button>
                  <button className="ghost" onClick={() => setSqlInput(SAMPLE_SQL)}>示例</button>
                  <button className="ghost danger" onClick={() => setSqlInput('')}>清空</button>
                </div>
              </div>
              <textarea value={sqlInput} onChange={(event) => setSqlInput(event.target.value)} spellCheck="false" />
            </article>

            <article className="panel output-panel">
              <div className="panel-header">
                <h2>格式化结果</h2>
                <span>复用 sql-format 格式化核心</span>
              </div>
              <pre className="formatted-result sql-result">{formattedSql || '请输入 SQL 后查看格式化结果。'}</pre>
            </article>
          </section>

          <div className="compact-stats" aria-label="SQL 统计信息">
            <span>{sqlStats.size} 字符</span>
            <span>{sqlStats.lines} 输入行</span>
            <span>{sqlStats.outputLines} 输出行</span>
          </div>
        </>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);