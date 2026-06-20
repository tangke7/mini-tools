import React from 'react';
import { Clipboard, Download } from 'lucide-react';

const TEMPLATES = [
  { id: 'hiveOds', name: 'Hive ODS 外部分区表', type: 'Hive', description: '适合原始日志、每日增量落地。' },
  { id: 'hiveDwd', name: 'Hive DWD 明细表', type: 'Hive', description: '适合清洗后的明细宽表。' },
  { id: 'icebergUpsert', name: 'Iceberg 明细表', type: 'Iceberg', description: '适合湖仓明细表和演进型 schema。' },
  { id: 'chMergeTree', name: 'ClickHouse MergeTree', type: 'ClickHouse', description: '适合通用明细查询和聚合分析。' },
  { id: 'chReplacing', name: 'ClickHouse ReplacingMergeTree', type: 'ClickHouse', description: '适合按版本字段去重的明细表。' },
  { id: 'chDistributed', name: 'ClickHouse Distributed', type: 'ClickHouse', description: '适合集群分布式查询入口表。' },
];

function quoteText(value) {
  return value.replaceAll("'", "\\'");
}

function normalize(value, fallback) {
  return value.trim() || fallback;
}

function commonColumnsForHive() {
  return [
    `  id bigint COMMENT '主键 ID'`,
    `  user_id string COMMENT '用户 ID'`,
    `  event_time timestamp COMMENT '事件时间'`,
    `  event_name string COMMENT '事件名称'`,
    `  ext_json string COMMENT '扩展信息'`,
  ].join(',\n');
}

function commonColumnsForClickHouse(extraColumns = []) {
  return [
    `  id Int64 COMMENT '主键 ID'`,
    `  user_id String COMMENT '用户 ID'`,
    `  event_time DateTime COMMENT '事件时间'`,
    `  event_name String COMMENT '事件名称'`,
    `  ext_json String COMMENT '扩展信息'`,
    ...extraColumns,
  ].join(',\n');
}

function buildTemplate(config) {
  const database = normalize(config.database, 'default');
  const tableName = normalize(config.tableName, 'dwd_user_event_di');
  const tableComment = quoteText(normalize(config.tableComment, '用户事件明细表'));
  const partitionField = normalize(config.partitionField, 'dt');
  const location = normalize(config.location, `/warehouse/${database}/${tableName}`);
  const ttlDays = normalize(config.ttlDays, '180');

  if (config.templateId === 'hiveOds') {
    return [
      `CREATE EXTERNAL TABLE IF NOT EXISTS ${database}.${tableName} (`,
      commonColumnsForHive(),
      `)`,
      `COMMENT '${tableComment}'`,
      `PARTITIONED BY (`,
      `  ${partitionField} string COMMENT '日期分区'`,
      `)`,
      `STORED AS ${config.fileFormat}`,
      `LOCATION '${quoteText(location)}'`,
      `TBLPROPERTIES (`,
      `  'orc.compress' = 'SNAPPY'`,
      `);`,
    ].join('\n');
  }

  if (config.templateId === 'hiveDwd') {
    return [
      `CREATE TABLE IF NOT EXISTS ${database}.${tableName} (`,
      commonColumnsForHive(),
      `)`,
      `COMMENT '${tableComment}'`,
      `PARTITIONED BY (`,
      `  ${partitionField} string COMMENT '日期分区'`,
      `)`,
      `STORED AS ${config.fileFormat}`,
      `TBLPROPERTIES (`,
      `  'lifecycle' = '${ttlDays}',`,
      `  'owner' = '${quoteText(normalize(config.owner, 'data_dev'))}'`,
      `);`,
    ].join('\n');
  }

  if (config.templateId === 'icebergUpsert') {
    return [
      `CREATE TABLE IF NOT EXISTS ${database}.${tableName} (`,
      commonColumnsForHive(),
      `)`,
      `COMMENT '${tableComment}'`,
      `PARTITIONED BY (${partitionField})`,
      `STORED BY ICEBERG`,
      `TBLPROPERTIES (`,
      `  'format-version' = '2',`,
      `  'write.format.default' = '${config.icebergFormat}',`,
      `  'write.target-file-size-bytes' = '536870912'`,
      `);`,
    ].join('\n');
  }

  if (config.templateId === 'chReplacing') {
    return [
      `CREATE TABLE IF NOT EXISTS ${database}.${tableName} (`,
      commonColumnsForClickHouse([`  version UInt64 COMMENT '版本号'`]),
      `)`,
      `ENGINE = ReplacingMergeTree(version)`,
      `PARTITION BY toYYYYMM(event_time)`,
      `ORDER BY (${normalize(config.orderBy, 'user_id, event_time')})`,
      `TTL event_time + INTERVAL ${ttlDays} DAY`,
      `SETTINGS index_granularity = 8192;`,
    ].join('\n');
  }

  if (config.templateId === 'chDistributed') {
    return [
      `CREATE TABLE IF NOT EXISTS ${database}.${tableName}_all AS ${database}.${tableName}_local`,
      `ENGINE = Distributed(${normalize(config.cluster, 'default_cluster')}, ${database}, ${tableName}_local, rand());`,
    ].join('\n');
  }

  return [
    `CREATE TABLE IF NOT EXISTS ${database}.${tableName} (`,
    commonColumnsForClickHouse(),
    `)`,
    `ENGINE = MergeTree`,
    `PARTITION BY toYYYYMM(event_time)`,
    `ORDER BY (${normalize(config.orderBy, 'user_id, event_time')})`,
    `TTL event_time + INTERVAL ${ttlDays} DAY`,
    `SETTINGS index_granularity = 8192;`,
  ].join('\n');
}

function TemplateLibrary() {
  const [copyText, setCopyText] = React.useState('复制模板');
  const [config, setConfig] = React.useState({
    templateId: 'hiveOds',
    database: 'default',
    tableName: 'dwd_user_event_di',
    tableComment: '用户事件明细表',
    partitionField: 'dt',
    fileFormat: 'ORC',
    icebergFormat: 'parquet',
    location: '/warehouse/default/dwd_user_event_di',
    owner: 'data_dev',
    ttlDays: '180',
    orderBy: 'user_id, event_time',
    cluster: 'default_cluster',
  });

  const activeTemplate = TEMPLATES.find((template) => template.id === config.templateId) ?? TEMPLATES[0];
  const sql = React.useMemo(() => buildTemplate(config), [config]);

  const setField = (key, value) => {
    setConfig((currentConfig) => ({ ...currentConfig, [key]: value }));
  };

  const copySql = async () => {
    await navigator.clipboard.writeText(sql);
    setCopyText('已复制');
    setTimeout(() => setCopyText('复制模板'), 1400);
  };

  const downloadSql = () => {
    const blob = new Blob([sql], { type: 'text/sql;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${config.tableName || 'create_table_template'}.sql`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <section className="workspace-grid ddl-workspace template-workspace">
        <article className="panel ddl-config-panel">
          <div className="panel-header">
            <h2>建表模板库</h2>
            <span>常用数据开发模板</span>
          </div>

          <div className="ddl-form-scroll">
            <section className="ddl-section">
              <h3>选择模板</h3>
              <div className="template-list">
                {TEMPLATES.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className={`template-card ${config.templateId === template.id ? 'is-active' : ''}`}
                    onClick={() => setField('templateId', template.id)}
                  >
                    <strong>{template.name}</strong>
                    <span>{template.type}</span>
                    <small>{template.description}</small>
                  </button>
                ))}
              </div>
            </section>

            <section className="ddl-section">
              <h3>模板参数</h3>
              <div className="ddl-form-grid">
                <label className="setting-field">
                  <span>数据库</span>
                  <input value={config.database} onChange={(event) => setField('database', event.target.value)} />
                </label>
                <label className="setting-field">
                  <span>表名</span>
                  <input value={config.tableName} onChange={(event) => setField('tableName', event.target.value)} />
                </label>
                <label className="setting-field ddl-field-wide">
                  <span>表注释</span>
                  <input value={config.tableComment} onChange={(event) => setField('tableComment', event.target.value)} />
                </label>
                {activeTemplate.type !== 'ClickHouse' && (
                  <label className="setting-field">
                    <span>分区字段</span>
                    <input value={config.partitionField} onChange={(event) => setField('partitionField', event.target.value)} />
                  </label>
                )}
                {activeTemplate.type === 'Hive' && (
                  <label className="setting-field">
                    <span>文件格式</span>
                    <select value={config.fileFormat} onChange={(event) => setField('fileFormat', event.target.value)}>
                      <option value="ORC">ORC</option>
                      <option value="PARQUET">PARQUET</option>
                      <option value="TEXTFILE">TEXTFILE</option>
                    </select>
                  </label>
                )}
                {activeTemplate.type === 'Iceberg' && (
                  <label className="setting-field">
                    <span>写入格式</span>
                    <select value={config.icebergFormat} onChange={(event) => setField('icebergFormat', event.target.value)}>
                      <option value="parquet">parquet</option>
                      <option value="orc">orc</option>
                      <option value="avro">avro</option>
                    </select>
                  </label>
                )}
                {['hiveOds'].includes(config.templateId) && (
                  <label className="setting-field ddl-field-wide">
                    <span>Location</span>
                    <input value={config.location} onChange={(event) => setField('location', event.target.value)} />
                  </label>
                )}
                {['hiveDwd', 'chMergeTree', 'chReplacing'].includes(config.templateId) && (
                  <label className="setting-field">
                    <span>生命周期天数</span>
                    <input value={config.ttlDays} onChange={(event) => setField('ttlDays', event.target.value)} />
                  </label>
                )}
                {activeTemplate.type === 'ClickHouse' && config.templateId !== 'chDistributed' && (
                  <label className="setting-field">
                    <span>ORDER BY</span>
                    <input value={config.orderBy} onChange={(event) => setField('orderBy', event.target.value)} />
                  </label>
                )}
                {config.templateId === 'chDistributed' && (
                  <label className="setting-field">
                    <span>集群名</span>
                    <input value={config.cluster} onChange={(event) => setField('cluster', event.target.value)} />
                  </label>
                )}
                {config.templateId === 'hiveDwd' && (
                  <label className="setting-field">
                    <span>Owner</span>
                    <input value={config.owner} onChange={(event) => setField('owner', event.target.value)} />
                  </label>
                )}
              </div>
            </section>
          </div>
        </article>

        <article className="panel output-panel">
          <div className="panel-header">
            <h2>模板 SQL</h2>
            <div className="panel-tools">
              <button type="button" onClick={copySql}><Clipboard size={15} />{copyText}</button>
              <button type="button" onClick={downloadSql}><Download size={15} />下载</button>
            </div>
          </div>
          <pre className="formatted-result sql-result ddl-result">{sql}</pre>
        </article>
      </section>

      <div className="compact-stats" aria-label="模板统计信息">
        <span>{activeTemplate.type}</span>
        <span>{activeTemplate.name}</span>
        <span>{sql.split('\n').length} 行 SQL</span>
      </div>
    </>
  );
}

export default TemplateLibrary;
