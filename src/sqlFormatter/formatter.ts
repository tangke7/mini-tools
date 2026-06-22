/**
 * SQL Formatter - 格式化输出
 * 按照模板风格生成格式化后的 SQL
 */

import { parseQuery } from './parser';
import type { ParsedQuery } from './parser';
import { tokenize, TokenType } from './tokenizer';
import type { Token } from './tokenizer';

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

// FROM/JOIN 类型关键字（顶层识别用）
// 包含 from 本身，以及各种 JOIN 修饰词
const JOIN_KEYWORDS = new Set(['from', 'join', 'left', 'right', 'inner', 'outer', 'full', 'cross']);

/**
 * 过滤掉空白和换行 token
 */
function sigTokens(tokens: Token[]): Token[] {
  return tokens.filter(t => t.type !== TokenType.WHITESPACE && t.type !== TokenType.NEWLINE);
}

/**
 * 将子查询 SQL 递归格式化，并在每行前加上 baseIndent 缩进
 */
function formatSubquery(innerSql: string, baseIndent: string, options: FormatOptions): string {
  const formatted = formatSQL(innerSql, options);
  return formatted
    .split('\n')
    .map(line => baseIndent + line)
    .join('\n');
}

/**
 * 将 FROM 子句的 token 列表解析为若干"片段"：
 * 每个片段是 { prefix: string, body: Token[] }
 * prefix 是 "from" / "join" / "left join" 等关键字组合
 * body 是该片段的表名/子查询 token（不含 ON 条件）
 * onTokens 是该片段的 ON 条件 token（可能为空）
 */
interface FromSegment {
  prefix: string;       // "from" / "join" / "left join" 等
  body: Token[];        // 表名或子查询 token
  onTokens: Token[];    // ON 条件 token
}

// 真正的 JOIN 分隔关键字（不含 from，from 只在最开头出现一次）
const JOIN_SEPARATOR_KEYWORDS = new Set(['join', 'left', 'right', 'inner', 'outer', 'full', 'cross']);

function splitFromSegments(tokens: Token[], kw: (k: string, opt: FormatOptions['keywordCase']) => string, options: FormatOptions): FromSegment[] {
  const sig = sigTokens(tokens);
  const segments: FromSegment[] = [];

  let i = 0;

  while (i < sig.length) {
    const t = sig[i];
    const lower = t.value.toLowerCase();

    // 识别 FROM/JOIN 前缀
    if (t.type === TokenType.KEYWORD && JOIN_KEYWORDS.has(lower)) {
      // 收集连续的 JOIN 类型关键字作为前缀
      const parts: string[] = [];
      while (i < sig.length && sig[i].type === TokenType.KEYWORD && JOIN_KEYWORDS.has(sig[i].value.toLowerCase())) {
        parts.push(kw(sig[i].value, options.keywordCase));
        i++;
      }
      const joinPrefix = parts.join(' ');

      // 收集 body token，直到遇到顶层 ON / 下一个 JOIN 分隔关键字
      const body: Token[] = [];
      let depth = 0;
      while (i < sig.length) {
        const cur = sig[i];
        const curLower = cur.value.toLowerCase();

        if (cur.type === TokenType.LPAREN) {
          depth++;
          body.push(cur);
          i++;
        } else if (cur.type === TokenType.RPAREN) {
          depth--;
          body.push(cur);
          i++;
        } else if (depth === 0 && cur.type === TokenType.KEYWORD && (curLower === 'on' || JOIN_SEPARATOR_KEYWORDS.has(curLower))) {
          break;
        } else {
          body.push(cur);
          i++;
        }
      }

      // 收集 ON 条件 token，直到遇到下一个顶层 JOIN 分隔关键字
      const onTokens: Token[] = [];
      if (i < sig.length && sig[i].type === TokenType.KEYWORD && sig[i].value.toLowerCase() === 'on') {
        i++; // 跳过 ON
        let depth2 = 0;
        while (i < sig.length) {
          const cur = sig[i];
          const curLower = cur.value.toLowerCase();
          if (cur.type === TokenType.LPAREN) depth2++;
          else if (cur.type === TokenType.RPAREN) depth2--;

          if (depth2 === 0 && cur.type === TokenType.KEYWORD && JOIN_SEPARATOR_KEYWORDS.has(curLower)) {
            break;
          }
          onTokens.push(cur);
          i++;
        }
      }

      segments.push({ prefix: joinPrefix, body, onTokens });
    } else {
      // 不是 FROM/JOIN 关键字，跳过
      i++;
    }
  }

  return segments;
}

/**
 * 将 token 列表转为文本（简单拼接，用空格分隔有意义的 token）
 */
function tokensToRawText(tokens: Token[]): string {
  const sig = sigTokens(tokens);
  if (sig.length === 0) return '';
  let result = sig[0].value;
  for (let i = 1; i < sig.length; i++) {
    const prev = sig[i - 1];
    const curr = sig[i];
    // 括号内外不加空格
    if (prev.type === TokenType.LPAREN || curr.type === TokenType.RPAREN) {
      result += curr.value;
    } else if (curr.type === TokenType.COMMA) {
      result += curr.value;
    } else if (prev.type === TokenType.COMMA) {
      result += ' ' + curr.value;
    } else if (prev.type === TokenType.DOT || curr.type === TokenType.DOT) {
      result += curr.value;
    } else {
      result += ' ' + curr.value;
    }
  }
  return result.trim();
}

/**
 * 判断 token 列表是否是一个子查询（括号包裹的 SELECT）
 * 返回括号内的 token（不含外层括号），以及别名
 */
function extractSubquery(tokens: Token[]): { innerTokens: Token[]; alias: string } | null {
  const sig = sigTokens(tokens);
  if (sig.length === 0) return null;

  // 格式：( SELECT ... ) [AS] alias
  if (sig[0].type !== TokenType.LPAREN) return null;

  // 找到匹配的右括号
  let depth = 0;
  let closeIdx = -1;
  for (let i = 0; i < sig.length; i++) {
    if (sig[i].type === TokenType.LPAREN) depth++;
    else if (sig[i].type === TokenType.RPAREN) {
      depth--;
      if (depth === 0) {
        closeIdx = i;
        break;
      }
    }
  }
  if (closeIdx < 0) return null;

  const innerTokens = sig.slice(1, closeIdx);
  // 检查括号内第一个有意义 token 是否是 SELECT
  const firstInner = innerTokens.find(t => t.type !== TokenType.WHITESPACE && t.type !== TokenType.NEWLINE);
  if (!firstInner || firstInner.value.toLowerCase() !== 'select') return null;

  // 提取别名（括号后面的 AS alias 或直接 alias）
  let alias = '';
  let aliasStart = closeIdx + 1;
  if (aliasStart < sig.length && sig[aliasStart].type === TokenType.KEYWORD && sig[aliasStart].value.toLowerCase() === 'as') {
    aliasStart++;
  }
  if (aliasStart < sig.length && (sig[aliasStart].type === TokenType.IDENTIFIER || sig[aliasStart].type === TokenType.KEYWORD)) {
    alias = sig[aliasStart].value;
  }

  return { innerTokens, alias };
}

/**
 * 格式化 FROM 子句（支持子查询递归格式化和 JOIN 换行）
 */
function formatFrom(query: ParsedQuery, options: FormatOptions): string[] {
  if (!query.from) return [];
  const kw = applyCase;
  const indent = options.indent;

  // 将 FROM 子句内容 tokenize
  const rawFrom = query.from.tables;
  const allTokens = tokenize(rawFrom);
  const sig = sigTokens(allTokens);

  // 在 sig 前面插入一个虚拟的 "from" 关键字，方便统一处理
  const fromToken: Token = { type: TokenType.KEYWORD, value: 'from', position: -1 };
  const fullSig = [fromToken, ...sig];

  const segments = splitFromSegments(fullSig, kw, options);

  const lines: string[] = [];

  for (const seg of segments) {
    const subq = extractSubquery(seg.body);

    if (subq) {
      // 子查询：递归格式化
      const innerSql = tokensToRawText(subq.innerTokens);
      const formattedInner = formatSubquery(innerSql, indent, options);
      const aliasPart = subq.alias ? ` ${kw('as', options.keywordCase)} ${subq.alias}` : '';
      lines.push(`${seg.prefix} (`);
      lines.push(formattedInner);
      lines.push(`)${aliasPart}`);
    } else {
      // 普通表名
      const tableText = tokensToRawText(seg.body);
      lines.push(`${seg.prefix} ${tableText}`);
    }

    // ON 条件
    if (seg.onTokens.length > 0) {
      const onText = tokensToRawText(seg.onTokens);
      lines.push(`${indent}${kw('on', options.keywordCase)} ${onText}`);
    }
  }

  return lines;
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
