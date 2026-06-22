import React from 'react';
import { Clipboard, Download, Plus, Trash2 } from 'lucide-react';

const TABLE_TYPES = [
  { id: 'hive', name: 'Hive' },
  { id: 'iceberg', name: 'Iceberg' },
  { id: 'clickhouse', name: 'ClickHouse' },
];

const OPERATION_OPTIONS = [
  { id: 'addColumns', name: '新增字段' },
  { id: 'modifyColumn', name: '修改字段类型' },
  { id: 'renameColumn', name: '重命名字段' },
  { id: 'dropColumn', name: '删除字段' },
  { id: 'commentColumn', name: '修改字段注释' },
  { id: 'commentTable', name: '修改表注释' },
  { id: 'addPartition', name: '新增分区' },
  { id: 'dropPartition', name: '删除分区' },
  { id: 'setProperties', name: '设置表属性' },
];

const CLICKHOUSE_UNSUPPORTED_OPERATIONS = new Set(['renameColumn', 'addPartition', 'setProperties']);

const DEFAULT_COLUMNS = [
  { id: 'c1', name: 'new_col', type: 'string', comment: '新增字段' },
];

const DEFAULT_PARTITIONS = [
  { id: 'p1', name: 'dt', value: '20260620' },
];

const DEFAULT_PROPERTIES = [
  { id: 'prop1', keyName: 'comment', value: '表属性示例' },
];

const normalizeIdentifier = (value, fallback) => value.trim() || fallback;
const quoteText = (value) => value.replaceAll("'", "\\'");

function createColumn() {
  return {
    id: crypto.randomUUID(),
    name: '',
    type: 'string',
    comment: '',
  };
}

function createPartition() {
  return {
    id: crypto.randomUUID(),
    name: 'dt',
    value: '',
  };
}

function createProperty() {
  return {
    id: crypto.randomUUID(),
    keyName: '',
    value: '',
  };
}

function getAvailableOperations(tableType) {
  if (tableType !== 'clickhouse') return OPERATION_OPTIONS;

  return OPERATION_OPTIONS.filter((operation) => !CLICKHOUSE_UNSUPPORTED_OPERATIONS.has(operation.id));
}

function buildFullTableName(config) {
  return `${normalizeIdentifier(config.database, 'default')}.${normalizeIdentifier(config.tableName, 'sample_table')}`;
}

function buildColumnDefinitions(columns, tableType) {
  return columns
    .filter((column) => column.name.trim())
    .map((column) => {
      const comment = column.comment.trim() ? ` COMMENT '${quoteText(column.comment.trim())}'` : '';

      if (tableType === 'clickhouse') {
        return `${column.name.trim()} ${column.type.trim() || 'String'}${comment}`;
      }

      return `${column.name.trim()} ${column.type.trim() || 'string'}${comment}`;
    });
}

function buildPartitionSpec(partitions, assignOperator = '=') {
  return partitions
    .filter((partition) => partition.name.trim())
    .map((partition) => `${partition.name.trim()}${assignOperator}'${quoteText(partition.value.trim())}'`)
    .join(', ');
}

function buildPropertyLines(properties) {
  return properties
    .filter((property) => property.keyName.trim())
    .map((property) => `  '${quoteText(property.keyName.trim())}' = '${quoteText(property.value.trim())}'`);
}

function buildAlterSql(config) {
  const tableName = buildFullTableName(config);
  const onCluster = config.tableType === 'clickhouse' && config.chUseOnCluster
    ? ` ON CLUSTER ${normalizeIdentifier(config.chOnClusterName, 'default_cluster')}`
    : '';
  const tableType = config.tableType;
  const operation = config.operation;
  const columns = buildColumnDefinitions(config.columns, tableType);
  const targetColumn = normalizeIdentifier(config.targetColumn, 'old_col');
  const newColumnName = normalizeIdentifier(config.newColumnName, 'new_col');
  const newColumnType = config.newColumnType.trim() || (tableType === 'clickhouse' ? 'String' : 'string');
  const columnComment = quoteText(config.columnComment.trim() || '字段注释');
  const tableComment = quoteText(config.tableComment.trim() || '表注释');
  const partitionSpec = buildPartitionSpec(config.partitions, '=');
  const clickHousePartitionSpec = config.clickhousePartition.trim() || '202606';
  const propertyLines = buildPropertyLines(config.properties);

  if (operation === 'addColumns') {
    if (tableType === 'clickhouse') {
      return columns.length
        ? columns.map((column) => `ALTER TABLE ${tableName}${onCluster} ADD COLUMN IF NOT EXISTS ${column};`).join('\n')
        : `ALTER TABLE ${tableName}${onCluster} ADD COLUMN IF NOT EXISTS new_col String COMMENT '新增字段';`;
    }

    return [
      `ALTER TABLE ${tableName} ADD COLUMNS (`,
      columns.length ? columns.map((column) => `  ${column}`).join(',\n') : `  new_col string COMMENT '新增字段'`,
      `);`,
    ].join('\n');
  }

  if (operation === 'modifyColumn') {
    if (tableType === 'clickhouse') {
      const comment = config.columnComment.trim() ? ` COMMENT '${columnComment}'` : '';
      return `ALTER TABLE ${tableName}${onCluster} MODIFY COLUMN ${targetColumn} ${newColumnType}${comment};`;
    }

    if (tableType === 'iceberg') {
      return `ALTER TABLE ${tableName} ALTER COLUMN ${targetColumn} TYPE ${newColumnType};`;
    }

    return `ALTER TABLE ${tableName} CHANGE COLUMN ${targetColumn} ${targetColumn} ${newColumnType} COMMENT '${columnComment}';`;
  }

  if (operation === 'renameColumn') {
    if (tableType === 'iceberg') {
      return `ALTER TABLE ${tableName} RENAME COLUMN ${targetColumn} TO ${newColumnName};`;
    }

    return `ALTER TABLE ${tableName} CHANGE COLUMN ${targetColumn} ${newColumnName} ${newColumnType} COMMENT '${columnComment}';`;
  }

  if (operation === 'dropColumn') {
    if (tableType === 'clickhouse') {
      return `ALTER TABLE ${tableName}${onCluster} DROP COLUMN IF EXISTS ${targetColumn};`;
    }

    return `ALTER TABLE ${tableName} DROP COLUMN ${targetColumn};`;
  }

  if (operation === 'commentColumn') {
    if (tableType === 'clickhouse') {
      return `ALTER TABLE ${tableName}${onCluster} COMMENT COLUMN ${targetColumn} '${columnComment}';`;
    }

    if (tableType === 'iceberg') {
      return `ALTER TABLE ${tableName} ALTER COLUMN ${targetColumn} COMMENT '${columnComment}';`;
    }

    return `ALTER TABLE ${tableName} CHANGE COLUMN ${targetColumn} ${targetColumn} ${newColumnType} COMMENT '${columnComment}';`;
  }

  if (operation === 'commentTable') {
    if (tableType === 'clickhouse') {
      return `ALTER TABLE ${tableName}${onCluster} MODIFY COMMENT '${tableComment}';`;
    }

    return `ALTER TABLE ${tableName} SET TBLPROPERTIES ('comment' = '${tableComment}');`;
  }

  if (operation === 'addPartition') {
    if (!partitionSpec) return `ALTER TABLE ${tableName} ADD IF NOT EXISTS PARTITION (dt='20260620');`;

    return `ALTER TABLE ${tableName} ADD IF NOT EXISTS PARTITION (${partitionSpec});`;
  }

  if (operation === 'dropPartition') {
    if (tableType === 'clickhouse') {
      return `ALTER TABLE ${tableName}${onCluster} DROP PARTITION '${quoteText(clickHousePartitionSpec)}';`;
    }

    if (!partitionSpec) return `ALTER TABLE ${tableName} DROP IF EXISTS PARTITION (dt='20260620');`;

    return `ALTER TABLE ${tableName} DROP IF EXISTS PARTITION (${partitionSpec});`;
  }

  if (operation === 'setProperties') {
    if (tableType === 'iceberg') {
      return [
        `ALTER TABLE ${tableName} SET TBLPROPERTIES (`,
        propertyLines.length ? propertyLines.join(',\n') : `  'write.format.default' = 'parquet'`,
        `);`,
      ].join('\n');
    }

    return [
      `ALTER TABLE ${tableName} SET TBLPROPERTIES (`,
      propertyLines.length ? propertyLines.join(',\n') : `  'comment' = '表属性示例'`,
      `);`,
    ].join('\n');
  }

  return `-- 请选择 ALTER 操作`;
}

function AlterBuilder() {
  const [copyText, setCopyText] = React.useState('复制 ALTER');
  const [config, setConfig] = React.useState({
    tableType: 'hive',
    operation: 'addColumns',
    database: 'default',
    tableName: 'dwd_user_event_di',
    chUseOnCluster: false,
    chOnClusterName: 'default_cluster',
    targetColumn: 'old_col',
    newColumnName: 'new_col',
    newColumnType: 'string',
    columnComment: '字段注释',
    tableComment: '表注释',
    clickhousePartition: '202606',
    columns: DEFAULT_COLUMNS,
    partitions: DEFAULT_PARTITIONS,
    properties: DEFAULT_PROPERTIES,
  });

  const availableOperations = React.useMemo(() => getAvailableOperations(config.tableType), [config.tableType]);
  const alterSql = React.useMemo(() => buildAlterSql(config), [config]);

  React.useEffect(() => {
    if (!availableOperations.some((operation) => operation.id === config.operation)) {
      setConfig((currentConfig) => ({ ...currentConfig, operation: availableOperations[0].id }));
    }
  }, [availableOperations, config.operation]);

  const setField = (key, value) => {
    setConfig((currentConfig) => ({ ...currentConfig, [key]: value }));
  };

  const updateListItem = (listKey, id, key, value) => {
    setConfig((currentConfig) => ({
      ...currentConfig,
      [listKey]: currentConfig[listKey].map((item) => item.id === id ? { ...item, [key]: value } : item),
    }));
  };

  const removeListItem = (listKey, id) => {
    setConfig((currentConfig) => ({
      ...currentConfig,
      [listKey]: currentConfig[listKey].filter((item) => item.id !== id),
    }));
  };

  const copyAlter = async () => {
    await navigator.clipboard.writeText(alterSql);
    setCopyText('已复制');
    setTimeout(() => setCopyText('复制 ALTER'), 1400);
  };

  const downloadAlter = () => {
    const blob = new Blob([alterSql], { type: 'text/sql;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${config.tableName || 'alter_table'}.alter.sql`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <section className="workspace-grid ddl-workspace alter-workspace">
        <article className="panel ddl-config-panel">
          <div className="panel-header">
            <h2>变更配置</h2>
            <span>字段 / 分区 / 表属性</span>
          </div>

          <div className="ddl-form-scroll">
            <div className="ddl-type-tabs" role="tablist" aria-label="ALTER 类型">
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
                  <span>操作类型</span>
                  <select value={config.operation} onChange={(event) => setField('operation', event.target.value)}>
                    {availableOperations.map((operation) => (
                      <option key={operation.id} value={operation.id}>{operation.name}</option>
                    ))}
                  </select>
                </label>
                {config.tableType === 'clickhouse' && (
                  <label className="setting-check ddl-check-card ddl-field-wide">
                    <input type="checkbox" checked={config.chUseOnCluster} onChange={(event) => setField('chUseOnCluster', event.target.checked)} />
                    <span>使用 ON CLUSTER</span>
                  </label>
                )}
                {config.tableType === 'clickhouse' && config.chUseOnCluster && (
                  <label className="setting-field ddl-field-wide">
                    <span>ON CLUSTER 集群名</span>
                    <input value={config.chOnClusterName} onChange={(event) => setField('chOnClusterName', event.target.value)} placeholder="default_cluster" />
                  </label>
                )}
              </div>
            </section>

            {config.operation === 'addColumns' && (
              <section className="ddl-section">
                <div className="ddl-section-title-row">
                  <h3>新增字段</h3>
                  <button type="button" className="ghost" onClick={() => setField('columns', [...config.columns, createColumn()])}>
                    <Plus size={14} />新增字段
                  </button>
                </div>
                <div className="ddl-table alter-column-table">
                  <div className="ddl-table-head">
                    <span>字段名</span>
                    <span>类型</span>
                    <span>注释</span>
                    <span />
                  </div>
                  {config.columns.map((column) => (
                    <div className="ddl-table-row" key={column.id}>
                      <input value={column.name} onChange={(event) => updateListItem('columns', column.id, 'name', event.target.value)} placeholder="字段名" />
                      <input value={column.type} onChange={(event) => updateListItem('columns', column.id, 'type', event.target.value)} placeholder="类型" />
                      <input value={column.comment} onChange={(event) => updateListItem('columns', column.id, 'comment', event.target.value)} placeholder="注释" />
                      <button type="button" className="icon-button danger" onClick={() => removeListItem('columns', column.id)} aria-label="删除字段">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {['modifyColumn', 'renameColumn', 'dropColumn', 'commentColumn'].includes(config.operation) && (
              <section className="ddl-section">
                <h3>字段变更</h3>
                <div className="ddl-form-grid">
                  <label className="setting-field">
                    <span>目标字段</span>
                    <input value={config.targetColumn} onChange={(event) => setField('targetColumn', event.target.value)} />
                  </label>
                  {config.operation === 'renameColumn' && (
                    <label className="setting-field">
                      <span>新字段名</span>
                      <input value={config.newColumnName} onChange={(event) => setField('newColumnName', event.target.value)} />
                    </label>
                  )}
                  {config.operation !== 'dropColumn' && (
                    <label className="setting-field">
                      <span>字段类型</span>
                      <input value={config.newColumnType} onChange={(event) => setField('newColumnType', event.target.value)} />
                    </label>
                  )}
                  {config.operation !== 'dropColumn' && (
                    <label className="setting-field ddl-field-wide">
                      <span>字段注释</span>
                      <input value={config.columnComment} onChange={(event) => setField('columnComment', event.target.value)} />
                    </label>
                  )}
                </div>
              </section>
            )}

            {config.operation === 'commentTable' && (
              <section className="ddl-section">
                <h3>表注释</h3>
                <label className="setting-field">
                  <span>新表注释</span>
                  <input value={config.tableComment} onChange={(event) => setField('tableComment', event.target.value)} />
                </label>
              </section>
            )}

            {['addPartition', 'dropPartition'].includes(config.operation) && config.tableType !== 'clickhouse' && (
              <section className="ddl-section">
                <div className="ddl-section-title-row">
                  <h3>分区配置</h3>
                  <button type="button" className="ghost" onClick={() => setField('partitions', [...config.partitions, createPartition()])}>
                    <Plus size={14} />新增分区键
                  </button>
                </div>
                <div className="ddl-table alter-partition-table">
                  <div className="ddl-table-head">
                    <span>分区字段</span>
                    <span>分区值</span>
                    <span />
                  </div>
                  {config.partitions.map((partition) => (
                    <div className="ddl-table-row" key={partition.id}>
                      <input value={partition.name} onChange={(event) => updateListItem('partitions', partition.id, 'name', event.target.value)} placeholder="dt" />
                      <input value={partition.value} onChange={(event) => updateListItem('partitions', partition.id, 'value', event.target.value)} placeholder="20260620" />
                      <button type="button" className="icon-button danger" onClick={() => removeListItem('partitions', partition.id)} aria-label="删除分区键">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {config.operation === 'dropPartition' && config.tableType === 'clickhouse' && (
              <section className="ddl-section">
                <h3>ClickHouse 分区</h3>
                <label className="setting-field">
                  <span>分区表达式值</span>
                  <input value={config.clickhousePartition} onChange={(event) => setField('clickhousePartition', event.target.value)} placeholder="202606" />
                </label>
              </section>
            )}

            {config.operation === 'setProperties' && (
              <section className="ddl-section">
                <div className="ddl-section-title-row">
                  <h3>表属性</h3>
                  <button type="button" className="ghost" onClick={() => setField('properties', [...config.properties, createProperty()])}>
                    <Plus size={14} />新增属性
                  </button>
                </div>
                <div className="ddl-table alter-property-table">
                  <div className="ddl-table-head">
                    <span>属性名</span>
                    <span>属性值</span>
                    <span />
                  </div>
                  {config.properties.map((property) => (
                    <div className="ddl-table-row" key={property.id}>
                      <input value={property.keyName} onChange={(event) => updateListItem('properties', property.id, 'keyName', event.target.value)} placeholder="write.format.default" />
                      <input value={property.value} onChange={(event) => updateListItem('properties', property.id, 'value', event.target.value)} placeholder="parquet" />
                      <button type="button" className="icon-button danger" onClick={() => removeListItem('properties', property.id)} aria-label="删除属性">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </article>

        <article className="panel output-panel">
          <div className="panel-header">
            <h2>实时生成 ALTER</h2>
            <div className="panel-tools">
              <button type="button" onClick={copyAlter}><Clipboard size={15} />{copyText}</button>
              <button type="button" onClick={downloadAlter}><Download size={15} />下载</button>
            </div>
          </div>
          <pre className="formatted-result sql-result ddl-result">{alterSql}</pre>
        </article>
      </section>

      <div className="compact-stats" aria-label="ALTER 统计信息">
        <span>{config.tableType.toUpperCase()}</span>
        <span>{availableOperations.find((operation) => operation.id === config.operation)?.name}</span>
        <span>{alterSql.split('\n').length} 行 ALTER</span>
      </div>
    </>
  );
}

export default AlterBuilder;
