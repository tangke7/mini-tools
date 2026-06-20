import React from 'react';
import { Clipboard, Download, Plus, Trash2 } from 'lucide-react';

const TABLE_TYPES = [
  { id: 'hive', name: 'Hive' },
  { id: 'iceberg', name: 'Iceberg' },
  { id: 'clickhouse', name: 'ClickHouse' },
];

const CLICKHOUSE_ENGINES = [
  'MergeTree',
  'ReplacingMergeTree',
  'SummingMergeTree',
  'AggregatingMergeTree',
  'Distributed',
  'Kafka',
  'S3',
  'Memory',
];

const HIVE_FORMATS = ['ORC', 'PARQUET', 'TEXTFILE'];
const ICEBERG_FORMATS = ['parquet', 'orc', 'avro'];

const DEFAULT_COLUMNS = [
  { id: 'c1', name: 'id', type: 'bigint', nullable: false, comment: '主键 ID' },
  { id: 'c2', name: 'user_id', type: 'string', nullable: true, comment: '用户 ID' },
  { id: 'c3', name: 'event_time', type: 'timestamp', nullable: true, comment: '事件时间' },
];

const DEFAULT_PARTITIONS = [
  { id: 'p1', name: 'dt', type: 'string', comment: '日期分区' },
];

const normalizeIdentifier = (value, fallback) => value.trim() || fallback;

const quoteComment = (value) => value.replaceAll("'", "\\'");

const CLICKHOUSE_TYPE_MAP = {
  string: 'String',
  varchar: 'String',
  char: 'String',
  bigint: 'Int64',
  int: 'Int32',
  integer: 'Int32',
  smallint: 'Int16',
  tinyint: 'Int8',
  double: 'Float64',
  float: 'Float32',
  boolean: 'Bool',
  bool: 'Bool',
  timestamp: 'DateTime',
  datetime: 'DateTime',
  date: 'Date',
};

function normalizeColumnType(type, dialect) {
  const normalizedType = type.trim() || 'string';

  if (dialect !== 'clickhouse') return normalizedType;

  return CLICKHOUSE_TYPE_MAP[normalizedType.toLowerCase()] ?? normalizedType;
}

function buildColumnLines(columns, dialect) {
  return columns
    .filter((column) => column.name.trim())
    .map((column) => {
      const columnType = normalizeColumnType(column.type, dialect);
      const nullable = dialect === 'clickhouse' && column.nullable ? 'Nullable(' : '';
      const nullableEnd = dialect === 'clickhouse' && column.nullable ? ')' : '';
      const comment = column.comment.trim() ? ` COMMENT '${quoteComment(column.comment.trim())}'` : '';

      return `  ${column.name.trim()} ${nullable}${columnType}${nullableEnd}${comment}`;
    });
}

function buildHiveDdl(config) {
  const database = normalizeIdentifier(config.database, 'default');
  const table = normalizeIdentifier(config.tableName, 'sample_table');
  const columns = buildColumnLines(config.columns, 'hive');
  const partitions = config.partitions
    .filter((partition) => partition.name.trim())
    .map((partition) => {
      const comment = partition.comment.trim() ? ` COMMENT '${quoteComment(partition.comment.trim())}'` : '';
      return `  ${partition.name.trim()} ${partition.type.trim() || 'string'}${comment}`;
    });
  const tableComment = config.tableComment.trim() ? `\nCOMMENT '${quoteComment(config.tableComment.trim())}'` : '';
  const external = config.externalTable ? 'EXTERNAL ' : '';
  const location = config.location.trim() ? `\nLOCATION '${quoteComment(config.location.trim())}'` : '';

  return [
    `CREATE ${external}TABLE IF NOT EXISTS ${database}.${table} (`,
    columns.join(',\n') || '  id bigint COMMENT \'主键 ID\'',
    `)${tableComment}`,
    partitions.length ? `PARTITIONED BY (\n${partitions.join(',\n')}\n)` : '',
    `STORED AS ${config.hiveFormat}`,
    location,
    ';',
  ].filter(Boolean).join('\n');
}

function buildIcebergDdl(config) {
  const database = normalizeIdentifier(config.database, 'default');
  const table = normalizeIdentifier(config.tableName, 'sample_table');
  const columns = buildColumnLines(config.columns, 'iceberg');
  const partitions = config.partitions
    .filter((partition) => partition.name.trim())
    .map((partition) => partition.name.trim());
  const tableComment = config.tableComment.trim() ? `\nCOMMENT '${quoteComment(config.tableComment.trim())}'` : '';
  const partitionClause = partitions.length ? `\nPARTITIONED BY (${partitions.join(', ')})` : '';
  const location = config.location.trim() ? `\nLOCATION '${quoteComment(config.location.trim())}'` : '';

  return [
    `CREATE TABLE IF NOT EXISTS ${database}.${table} (`,
    columns.join(',\n') || '  id bigint COMMENT \'主键 ID\'',
    `)${tableComment}${partitionClause}`,
    `STORED BY ICEBERG`,
    `TBLPROPERTIES (`,
    `  'format-version' = '${config.icebergFormatVersion}',`,
    `  'write.format.default' = '${config.icebergFormat}'`,
    `)`,
    location,
    ';',
  ].filter(Boolean).join('\n');
}

function buildClickHouseEngine(config) {
  const engine = config.clickhouseEngine;

  if (engine === 'Distributed') {
    return `Distributed(${config.chCluster || 'cluster_name'}, ${config.database || 'default'}, ${config.chLocalTable || `${config.tableName || 'sample_table'}_local`}, ${config.chShardingKey || 'rand()'})`;
  }

  if (engine === 'Kafka') {
    return `Kafka SETTINGS kafka_broker_list = '${config.chKafkaBrokers || 'localhost:9092'}', kafka_topic_list = '${config.chKafkaTopic || 'topic_name'}', kafka_group_name = '${config.chKafkaGroup || 'consumer_group'}', kafka_format = '${config.chKafkaFormat || 'JSONEachRow'}'`;
  }

  if (engine === 'S3') {
    return `S3('${config.chS3Path || 's3://bucket/path/*.parquet'}', '${config.chS3Format || 'Parquet'}')`;
  }

  if (engine === 'Memory') {
    return 'Memory';
  }

  if (engine === 'ReplacingMergeTree') {
    const version = config.chVersionColumn.trim() ? `(${config.chVersionColumn.trim()})` : '';
    return `ReplacingMergeTree${version}`;
  }

  return engine;
}

function buildClickHouseDdl(config) {
  const database = normalizeIdentifier(config.database, 'default');
  const table = normalizeIdentifier(config.tableName, 'sample_table');
  const columns = buildColumnLines(config.columns, 'clickhouse');
  const tableComment = config.tableComment.trim() ? `\nCOMMENT '${quoteComment(config.tableComment.trim())}'` : '';
  const engine = buildClickHouseEngine(config);
  const orderBy = config.chOrderBy.trim() ? config.chOrderBy.trim() : 'tuple()';
  const partitionBy = config.chPartitionBy.trim() ? `\nPARTITION BY ${config.chPartitionBy.trim()}` : '';
  const primaryKey = config.chPrimaryKey.trim() ? `\nPRIMARY KEY ${config.chPrimaryKey.trim()}` : '';
  const ttl = config.chTtl.trim() ? `\nTTL ${config.chTtl.trim()}` : '';
  const settings = config.chSettings.trim() ? `\nSETTINGS ${config.chSettings.trim()}` : '';
  const onCluster = config.chUseOnCluster ? ` ON CLUSTER ${normalizeIdentifier(config.chOnClusterName, 'default_cluster')}` : '';
  const needMergeTreeClause = engine.includes('MergeTree');

  return [
    `CREATE TABLE IF NOT EXISTS ${database}.${table}${onCluster} (`,
    columns.join(',\n') || '  id UInt64 COMMENT \'主键 ID\'',
    `)${tableComment}`,
    `ENGINE = ${engine}`,
    needMergeTreeClause ? `ORDER BY ${orderBy}${partitionBy}${primaryKey}${ttl}${settings}` : '',
    ';',
  ].filter(Boolean).join('\n');
}

function buildDdl(config) {
  if (config.tableType === 'iceberg') return buildIcebergDdl(config);
  if (config.tableType === 'clickhouse') return buildClickHouseDdl(config);
  return buildHiveDdl(config);
}

function createColumn() {
  return {
    id: crypto.randomUUID(),
    name: '',
    type: 'string',
    nullable: true,
    comment: '',
  };
}

function createPartition() {
  return {
    id: crypto.randomUUID(),
    name: '',
    type: 'string',
    comment: '',
  };
}

function DdlBuilder() {
  const [copyText, setCopyText] = React.useState('复制 DDL');
  const [config, setConfig] = React.useState({
    tableType: 'hive',
    database: 'default',
    tableName: 'dwd_user_event_di',
    tableComment: '用户事件明细表',
    externalTable: true,
    location: '/warehouse/default/dwd_user_event_di',
    hiveFormat: 'ORC',
    icebergFormat: 'parquet',
    icebergFormatVersion: '2',
    clickhouseEngine: 'MergeTree',
    chOrderBy: '(dt, user_id)',
    chPartitionBy: 'toYYYYMM(event_time)',
    chPrimaryKey: '',
    chVersionColumn: '',
    chTtl: '',
    chSettings: 'index_granularity = 8192',
    chUseOnCluster: false,
    chOnClusterName: 'default_cluster',
    chCluster: 'default_cluster',
    chLocalTable: 'dwd_user_event_di_local',
    chShardingKey: 'rand()',
    chKafkaBrokers: 'localhost:9092',
    chKafkaTopic: 'user_event',
    chKafkaGroup: 'mini_tools_group',
    chKafkaFormat: 'JSONEachRow',
    chS3Path: 's3://bucket/path/*.parquet',
    chS3Format: 'Parquet',
    columns: DEFAULT_COLUMNS,
    partitions: DEFAULT_PARTITIONS,
  });

  const ddl = React.useMemo(() => buildDdl(config), [config]);

  const setField = (key, value) => {
    setConfig((currentConfig) => ({ ...currentConfig, [key]: value }));
  };

  const updateColumn = (id, key, value) => {
    setConfig((currentConfig) => ({
      ...currentConfig,
      columns: currentConfig.columns.map((column) => column.id === id ? { ...column, [key]: value } : column),
    }));
  };

  const updatePartition = (id, key, value) => {
    setConfig((currentConfig) => ({
      ...currentConfig,
      partitions: currentConfig.partitions.map((partition) => partition.id === id ? { ...partition, [key]: value } : partition),
    }));
  };

  const removeColumn = (id) => {
    setConfig((currentConfig) => ({
      ...currentConfig,
      columns: currentConfig.columns.filter((column) => column.id !== id),
    }));
  };

  const removePartition = (id) => {
    setConfig((currentConfig) => ({
      ...currentConfig,
      partitions: currentConfig.partitions.filter((partition) => partition.id !== id),
    }));
  };

  const copyDdl = async () => {
    await navigator.clipboard.writeText(ddl);
    setCopyText('已复制');
    setTimeout(() => setCopyText('复制 DDL'), 1400);
  };

  const downloadDdl = () => {
    const blob = new Blob([ddl], { type: 'text/sql;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${config.tableName || 'create_table'}.sql`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <section className="workspace-grid ddl-workspace">
        <article className="panel ddl-config-panel">
          <div className="panel-header">
            <h2>建表配置</h2>
            <span>Hive / Iceberg / ClickHouse</span>
          </div>

          <div className="ddl-form-scroll">
            <div className="ddl-type-tabs" role="tablist" aria-label="DDL 类型">
              {TABLE_TYPES.map((tableType) => (
                <button
                  key={tableType.id}
                  type="button"
                  role="tab"
                  className={config.tableType === tableType.id ? 'is-active' : ''}
                  aria-selected={config.tableType === tableType.id}
                  onClick={() => setField('tableType', tableType.id)}
                >
                  {tableType.name}
                </button>
              ))}
            </div>

            <section className="ddl-section">
              <h3>基础信息</h3>
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
              </div>
            </section>

            <section className="ddl-section">
              <div className="ddl-section-title-row">
                <h3>字段列表</h3>
                <button type="button" className="ghost" onClick={() => setField('columns', [...config.columns, createColumn()])}>
                  <Plus size={14} />新增字段
                </button>
              </div>
              <div className="ddl-table ddl-column-table">
                <div className="ddl-table-head">
                  <span>字段名</span>
                  <span>类型</span>
                  <span>可空</span>
                  <span>注释</span>
                  <span />
                </div>
                {config.columns.map((column) => (
                  <div className="ddl-table-row" key={column.id}>
                    <input value={column.name} onChange={(event) => updateColumn(column.id, 'name', event.target.value)} placeholder="字段名" />
                    <input value={column.type} onChange={(event) => updateColumn(column.id, 'type', event.target.value)} placeholder="类型" />
                    <label className="ddl-inline-check">
                      <input type="checkbox" checked={column.nullable} onChange={(event) => updateColumn(column.id, 'nullable', event.target.checked)} />
                    </label>
                    <input value={column.comment} onChange={(event) => updateColumn(column.id, 'comment', event.target.value)} placeholder="注释" />
                    <button type="button" className="icon-button danger" onClick={() => removeColumn(column.id)} aria-label="删除字段">
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </section>

            {config.tableType !== 'clickhouse' && (
              <section className="ddl-section">
                <div className="ddl-section-title-row">
                  <h3>分区字段</h3>
                  <button type="button" className="ghost" onClick={() => setField('partitions', [...config.partitions, createPartition()])}>
                    <Plus size={14} />新增分区
                  </button>
                </div>
                <div className="ddl-table ddl-partition-table">
                  <div className="ddl-table-head">
                    <span>字段名</span>
                    <span>类型</span>
                    <span>注释</span>
                    <span />
                  </div>
                  {config.partitions.map((partition) => (
                    <div className="ddl-table-row" key={partition.id}>
                      <input value={partition.name} onChange={(event) => updatePartition(partition.id, 'name', event.target.value)} placeholder="分区字段" />
                      <input value={partition.type} onChange={(event) => updatePartition(partition.id, 'type', event.target.value)} placeholder="类型" />
                      <input value={partition.comment} onChange={(event) => updatePartition(partition.id, 'comment', event.target.value)} placeholder="注释" />
                      <button type="button" className="icon-button danger" onClick={() => removePartition(partition.id)} aria-label="删除分区">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {config.tableType === 'hive' && (
              <section className="ddl-section">
                <h3>Hive 选项</h3>
                <div className="ddl-form-grid">
                  <label className="setting-field">
                    <span>存储格式</span>
                    <select value={config.hiveFormat} onChange={(event) => setField('hiveFormat', event.target.value)}>
                      {HIVE_FORMATS.map((format) => <option key={format} value={format}>{format}</option>)}
                    </select>
                  </label>
                  <label className="setting-check ddl-check-card">
                    <input type="checkbox" checked={config.externalTable} onChange={(event) => setField('externalTable', event.target.checked)} />
                    <span>外部表</span>
                  </label>
                  <label className="setting-field ddl-field-wide">
                    <span>Location</span>
                    <input value={config.location} onChange={(event) => setField('location', event.target.value)} />
                  </label>
                </div>
              </section>
            )}

            {config.tableType === 'iceberg' && (
              <section className="ddl-section">
                <h3>Iceberg 选项</h3>
                <div className="ddl-form-grid">
                  <label className="setting-field">
                    <span>文件格式</span>
                    <select value={config.icebergFormat} onChange={(event) => setField('icebergFormat', event.target.value)}>
                      {ICEBERG_FORMATS.map((format) => <option key={format} value={format}>{format}</option>)}
                    </select>
                  </label>
                  <label className="setting-field">
                    <span>Format Version</span>
                    <select value={config.icebergFormatVersion} onChange={(event) => setField('icebergFormatVersion', event.target.value)}>
                      <option value="1">1</option>
                      <option value="2">2</option>
                    </select>
                  </label>
                  <label className="setting-field ddl-field-wide">
                    <span>Location</span>
                    <input value={config.location} onChange={(event) => setField('location', event.target.value)} />
                  </label>
                </div>
              </section>
            )}

            {config.tableType === 'clickhouse' && (
              <section className="ddl-section">
                <h3>ClickHouse 引擎</h3>
                <div className="ddl-form-grid">
                  <label className="setting-field">
                    <span>Engine</span>
                    <select value={config.clickhouseEngine} onChange={(event) => setField('clickhouseEngine', event.target.value)}>
                      {CLICKHOUSE_ENGINES.map((engine) => <option key={engine} value={engine}>{engine}</option>)}
                    </select>
                  </label>
                  <label className="setting-check ddl-check-card">
                    <input type="checkbox" checked={config.chUseOnCluster} onChange={(event) => setField('chUseOnCluster', event.target.checked)} />
                    <span>使用 ON CLUSTER</span>
                  </label>
                  {config.chUseOnCluster && (
                    <label className="setting-field ddl-field-wide">
                      <span>ON CLUSTER 集群名</span>
                      <input value={config.chOnClusterName} onChange={(event) => setField('chOnClusterName', event.target.value)} placeholder="default_cluster" />
                    </label>
                  )}

                  {config.clickhouseEngine.includes('MergeTree') && (
                    <>
                      <label className="setting-field">
                        <span>ORDER BY</span>
                        <input value={config.chOrderBy} onChange={(event) => setField('chOrderBy', event.target.value)} />
                      </label>
                      <label className="setting-field">
                        <span>PARTITION BY</span>
                        <input value={config.chPartitionBy} onChange={(event) => setField('chPartitionBy', event.target.value)} />
                      </label>
                      <label className="setting-field">
                        <span>PRIMARY KEY</span>
                        <input value={config.chPrimaryKey} onChange={(event) => setField('chPrimaryKey', event.target.value)} />
                      </label>
                      {config.clickhouseEngine === 'ReplacingMergeTree' && (
                        <label className="setting-field">
                          <span>版本字段</span>
                          <input value={config.chVersionColumn} onChange={(event) => setField('chVersionColumn', event.target.value)} />
                        </label>
                      )}
                      <label className="setting-field ddl-field-wide">
                        <span>TTL</span>
                        <input value={config.chTtl} onChange={(event) => setField('chTtl', event.target.value)} placeholder="event_time + INTERVAL 180 DAY" />
                      </label>
                      <label className="setting-field ddl-field-wide">
                        <span>SETTINGS</span>
                        <input value={config.chSettings} onChange={(event) => setField('chSettings', event.target.value)} />
                      </label>
                    </>
                  )}

                  {config.clickhouseEngine === 'Distributed' && (
                    <>
                      <label className="setting-field">
                        <span>集群名</span>
                        <input value={config.chCluster} onChange={(event) => setField('chCluster', event.target.value)} />
                      </label>
                      <label className="setting-field">
                        <span>本地表</span>
                        <input value={config.chLocalTable} onChange={(event) => setField('chLocalTable', event.target.value)} />
                      </label>
                      <label className="setting-field ddl-field-wide">
                        <span>分片 Key</span>
                        <input value={config.chShardingKey} onChange={(event) => setField('chShardingKey', event.target.value)} />
                      </label>
                    </>
                  )}

                  {config.clickhouseEngine === 'Kafka' && (
                    <>
                      <label className="setting-field">
                        <span>Brokers</span>
                        <input value={config.chKafkaBrokers} onChange={(event) => setField('chKafkaBrokers', event.target.value)} />
                      </label>
                      <label className="setting-field">
                        <span>Topic</span>
                        <input value={config.chKafkaTopic} onChange={(event) => setField('chKafkaTopic', event.target.value)} />
                      </label>
                      <label className="setting-field">
                        <span>Group</span>
                        <input value={config.chKafkaGroup} onChange={(event) => setField('chKafkaGroup', event.target.value)} />
                      </label>
                      <label className="setting-field">
                        <span>Format</span>
                        <input value={config.chKafkaFormat} onChange={(event) => setField('chKafkaFormat', event.target.value)} />
                      </label>
                    </>
                  )}

                  {config.clickhouseEngine === 'S3' && (
                    <>
                      <label className="setting-field ddl-field-wide">
                        <span>S3 路径</span>
                        <input value={config.chS3Path} onChange={(event) => setField('chS3Path', event.target.value)} />
                      </label>
                      <label className="setting-field">
                        <span>格式</span>
                        <input value={config.chS3Format} onChange={(event) => setField('chS3Format', event.target.value)} />
                      </label>
                    </>
                  )}
                </div>
              </section>
            )}
          </div>
        </article>

        <article className="panel output-panel">
          <div className="panel-header">
            <h2>实时生成 DDL</h2>
            <div className="panel-tools">
              <button type="button" onClick={copyDdl}><Clipboard size={15} />{copyText}</button>
              <button type="button" onClick={downloadDdl}><Download size={15} />下载</button>
            </div>
          </div>
          <pre className="formatted-result sql-result ddl-result">{ddl}</pre>
        </article>
      </section>

      <div className="compact-stats" aria-label="DDL 统计信息">
        <span>{config.tableType.toUpperCase()}</span>
        <span>{config.columns.length} 个字段</span>
        <span>{ddl.split('\n').length} 行 DDL</span>
      </div>
    </>
  );
}

export default DdlBuilder;
