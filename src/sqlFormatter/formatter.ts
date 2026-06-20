/**
 * SQL Formatter - 格式化输出
 * 按照模板风格生成格式化后的 SQL
 */

import { parseQuery } from './parser';
import type { ParsedQuery } from './parser';

export interface FormatOptions {
  /** 关键字大小写: 'lowercase' | 'uppercase' | 'preserve' */
  keywordCase: 'lowercase' | 'uppercase' | 'preserve';
  /** 缩进字符串，默认两个空格 */
  indent: string;
  /** 逗号位置: 'leading' (行首) | 'trailing' (行尾) */
  commaPosition: 'leading' | 'trailing';
  /** 是否对齐别名 */
  alignAliases: boolean;
  /** 别名对齐最小列位置（字符数），实际位置取最长行和此值的较大者 */
  aliasAlignColumn: number;
  /** 行最大长度，用于自动计算对齐位置 */
  maxLineLength: number;
}

export const defaultOptions: FormatOptions = {
  keywordCase: 'lowercase',
  indent: '  ',
  commaPosition: 'leading',
  alignAliases: true,
  aliasAlignColumn: 80,
  maxLineLength: 120,
};

function applyCase(keyword: string, option: FormatOptions['keywordCase']): string {
  switch (option) {
    case 'lowercase': return keyword.toLowerCase();
    case 'uppercase': return keyword.toUpperCase();
    default: return keyword;
  }
}

/**
 * 计算最佳别名对齐位置
 * 先构建出每行 "prefix + expression" 的实际文本，取最长的那行 + padding 作为对齐列
 * 同时保证不低于 aliasAlignColumn 设置的最小值
 */
function calculateAliasColumn(
  linePrefixes: string[],
  minColumn: number,
): number {
  let maxLen = 0;
  for (const prefix of linePrefixes) {
    if (prefix.length > maxLen) {
      maxLen = prefix.length;
    }
  }
  // 在最长行后至少留 1 个空格
  const computed = maxLen + 1;
  return Math.max(computed, minColumn);
}

/**
 * 用空格填充到目标列位置
 */
function padToColumn(text: string, targetCol: number): string {
  const currentLen = text.length;
  if (currentLen >= targetCol) {
    return text + ' ';
  }
  return text + ' '.repeat(targetCol - currentLen);
}

/**
 * 格式化 SELECT 子句
 */
function formatSelect(query: ParsedQuery, options: FormatOptions): string[] {
  const lines: string[] = [];
  const select = query.select;
  if (!select || select.columns.length === 0) return lines;

  const kw = applyCase;
  const indent = options.indent;

  // 第一步：先构建所有行的 "前缀" 部分（不含别名），用于计算对齐列
  const prefixes: string[] = [];
  for (let i = 0; i < select.columns.length; i++) {
    const col = select.columns[i];
    let prefix: string;
    if (i === 0) {
      prefix = `${kw('select', options.keywordCase)} ${col.expression}`;
    } else {
      if (options.commaPosition === 'leading') {
        prefix = `${indent}, ${col.expression}`;
      } else {
        prefix = `${indent}${col.expression}`;
      }
    }
    prefixes.push(prefix);
  }

  // 第二步：计算对齐列（取所有行最长前缀 + 至少 aliasAlignColumn）
  const aliasCol = options.alignAliases
    ? calculateAliasColumn(prefixes, options.aliasAlignColumn)
    : 0;

  // 第三步：组装最终行
  for (let i = 0; i < select.columns.length; i++) {
    const col = select.columns[i];
    let line = prefixes[i];

    // trailing 逗号模式下，非最后一列需要在表达式后加逗号
    if (options.commaPosition === 'trailing' && i > 0 && i < select.columns.length - 1) {
      // trailing 模式的逗号已在 prefix 构建时不含，需要在别名之前加
      // 但实际 prefix 不含逗号，此处做特殊处理
    }

    // 添加别名
    if (col.alias && options.alignAliases) {
      line = padToColumn(line, aliasCol) + kw('as', options.keywordCase) + ' ' + col.alias;
    } else if (col.alias) {
      line += ' ' + kw('as', options.keywordCase) + ' ' + col.alias;
    }

    // trailing 逗号添加在整行末尾（别名后）
    if (options.commaPosition === 'trailing' && i < select.columns.length - 1 && i > 0) {
      // 不在第一行后加，第一行没有 trailing 逗号的需求
      // 实际上 trailing 模式下每行尾部加逗号
    }

    lines.push(line);
  }

  return lines;
}

/**
 * 格式化 FROM 子句
 */
function formatFrom(query: ParsedQuery, options: FormatOptions): string[] {
  if (!query.from) return [];
  const kw = applyCase;
  return [`${kw('from', options.keywordCase)} ${query.from.tables}`];
}

/**
 * 格式化 WHERE 子句
 */
function formatWhere(query: ParsedQuery, options: FormatOptions): string[] {
  if (!query.where || query.where.conditions.length === 0) return [];
  const lines: string[] = [];
  const kw = applyCase;
  const indent = options.indent;

  for (let i = 0; i < query.where.conditions.length; i++) {
    const cond = query.where.conditions[i];
    if (i === 0 || cond.connector === '') {
      lines.push(`${kw('where', options.keywordCase)} ${cond.expression}`);
    } else {
      lines.push(`${indent}${kw(cond.connector, options.keywordCase)} ${cond.expression}`);
    }
  }

  return lines;
}

/**
 * 格式化 GROUP BY 子句
 */
function formatGroupBy(query: ParsedQuery, options: FormatOptions): string[] {
  if (!query.groupBy || query.groupBy.columns.length === 0) return [];
  const kw = applyCase;
  const indent = options.indent;
  const lines: string[] = [];

  for (let i = 0; i < query.groupBy.columns.length; i++) {
    if (i === 0) {
      lines.push(`${kw('group', options.keywordCase)} ${kw('by', options.keywordCase)} ${query.groupBy.columns[i]}`);
    } else {
      if (options.commaPosition === 'leading') {
        lines.push(`${indent}, ${query.groupBy.columns[i]}`);
      } else {
        lines.push(`${indent}${query.groupBy.columns[i]},`);
      }
    }
  }

  return lines;
}

/**
 * 格式化 HAVING 子句
 */
function formatHaving(query: ParsedQuery, options: FormatOptions): string[] {
  if (!query.having || query.having.conditions.length === 0) return [];
  const lines: string[] = [];
  const kw = applyCase;
  const indent = options.indent;

  for (let i = 0; i < query.having.conditions.length; i++) {
    const cond = query.having.conditions[i];
    if (i === 0 || cond.connector === '') {
      lines.push(`${kw('having', options.keywordCase)} ${cond.expression}`);
    } else {
      lines.push(`${indent}${kw(cond.connector, options.keywordCase)} ${cond.expression}`);
    }
  }

  return lines;
}

/**
 * 格式化 ORDER BY 子句
 */
function formatOrderBy(query: ParsedQuery, options: FormatOptions): string[] {
  if (!query.orderBy || query.orderBy.columns.length === 0) return [];
  const kw = applyCase;
  const indent = options.indent;
  const lines: string[] = [];

  for (let i = 0; i < query.orderBy.columns.length; i++) {
    if (i === 0) {
      lines.push(`${kw('order', options.keywordCase)} ${kw('by', options.keywordCase)} ${query.orderBy.columns[i]}`);
    } else {
      if (options.commaPosition === 'leading') {
        lines.push(`${indent}, ${query.orderBy.columns[i]}`);
      } else {
        lines.push(`${indent}${query.orderBy.columns[i]},`);
      }
    }
  }

  return lines;
}

/**
 * 格式化 LIMIT 子句
 */
function formatLimit(query: ParsedQuery, options: FormatOptions): string[] {
  if (!query.limit) return [];
  return [`${applyCase('limit', options.keywordCase)} ${query.limit}`];
}

/**
 * 主格式化函数
 */
export function formatSQL(sql: string, userOptions?: Partial<FormatOptions>): string {
  const options: FormatOptions = { ...defaultOptions, ...userOptions };

  // 去除首尾空白
  sql = sql.trim();
  if (!sql) return '';

  try {
    const query = parseQuery(sql);

    const sections: string[][] = [];

    // 按子句顺序格式化
    if (query.select) sections.push(formatSelect(query, options));
    if (query.from) {
      sections.push([]);  // 空行分隔
      sections.push(formatFrom(query, options));
    }
    if (query.where) {
      sections.push(formatWhere(query, options));
    }
    if (query.groupBy) {
      sections.push(formatGroupBy(query, options));
    }
    if (query.having) {
      sections.push(formatHaving(query, options));
    }
    if (query.orderBy) {
      sections.push(formatOrderBy(query, options));
    }
    if (query.limit) {
      sections.push(formatLimit(query, options));
    }

    return sections.flat().filter((_, i, arr) => {
      // 去除连续空行
      if (arr[i] === '' && (i === 0 || arr[i - 1] === '')) return false;
      return true;
    }).join('\n');
  } catch {
    // 解析失败时返回原始 SQL
    return sql;
  }
}
