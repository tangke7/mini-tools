/**
 * SQL Parser - 结构解析器
 * 将 token 序列解析为 SQL 结构
 */

import { type Token, TokenType, tokenize } from './tokenizer';

export interface SelectColumn {
  expression: string;     // 列表达式（去除首尾空白）
  alias?: string;         // 列别名
  hasAs: boolean;         // 是否使用了 AS 关键字
}

export interface WhereCondition {
  connector: string;      // '', 'and', 'or'
  expression: string;     // 条件表达式
}

export interface SqlClause {
  type: 'select' | 'from' | 'where' | 'group_by' | 'having' | 'order_by' | 'limit' | 'with' | 'join' | 'on' | 'union' | 'insert' | 'set' | 'other';
  raw: string;            // 原始文本
}

export interface ParsedSelect {
  columns: SelectColumn[];
}

export interface ParsedFrom {
  tables: string;         // FROM 子句内容
}

export interface ParsedWhere {
  conditions: WhereCondition[];
}

export interface ParsedGroupBy {
  columns: string[];
}

export interface ParsedOrderBy {
  columns: string[];
}

export interface ParsedQuery {
  select?: ParsedSelect;
  from?: ParsedFrom;
  where?: ParsedWhere;
  groupBy?: ParsedGroupBy;
  having?: ParsedWhere;
  orderBy?: ParsedOrderBy;
  limit?: string;
  clauses: SqlClause[];   // 按顺序的子句
  raw: string;            // 原始 SQL
}

/**
 * 过滤掉空白和换行 token，但保留注释
 */
function significantTokens(tokens: Token[]): Token[] {
  return tokens.filter(t =>
    t.type !== TokenType.WHITESPACE &&
    t.type !== TokenType.NEWLINE
  );
}

/**
 * 判断两个相邻 token 之间是否需要空格
 */
function needsSpaceBetween(prev: Token, curr: Token): boolean {
  // 左括号后不加空格
  if (prev.type === TokenType.LPAREN) return false;
  // 右括号前不加空格
  if (curr.type === TokenType.RPAREN) return false;
  // 逗号前不加空格
  if (curr.type === TokenType.COMMA) return false;
  // 逗号后加空格
  if (prev.type === TokenType.COMMA) return true;
  // 点号前后不加空格
  if (prev.type === TokenType.DOT || curr.type === TokenType.DOT) return false;
  // 标识符/关键字/数字/字符串之间都需要空格
  const wordLike: string[] = [TokenType.KEYWORD, TokenType.IDENTIFIER, TokenType.NUMBER, TokenType.STRING];
  if (wordLike.includes(prev.type) && wordLike.includes(curr.type)) return true;
  // 运算符前后加空格（除了一元运算符之类特殊情况）
  if (prev.type === TokenType.OPERATOR || curr.type === TokenType.OPERATOR) return true;
  // 右括号后跟关键字/标识符/数字
  if (prev.type === TokenType.RPAREN && wordLike.includes(curr.type)) return true;
  // 关键字后跟左括号：
  // 函数类关键字（cast, case, if 等）不加空格
  // SQL 关键字（in, not, exists, between 等）需要空格
  if (prev.type === TokenType.KEYWORD && curr.type === TokenType.LPAREN) {
    const funcKeywords = ['cast', 'case', 'if', 'coalesce', 'nullif', 'trim', 'extract', 'substring', 'position', 'overlay', 'convert'];
    return !funcKeywords.includes(prev.value.toLowerCase());
  }
  // 标识符/数字后跟左括号：函数调用，不加空格
  if (wordLike.includes(prev.type) && curr.type === TokenType.LPAREN) return false;
  // 星号
  if (prev.type === TokenType.STAR || curr.type === TokenType.STAR) return true;
  
  return false;
}

/**
 * 从 significant token 列表中提取文本，智能添加空格
 */
function tokensToText(tokens: Token[]): string {
  if (tokens.length === 0) return '';
  
  let result = tokens[0].value;
  for (let i = 1; i < tokens.length; i++) {
    if (needsSpaceBetween(tokens[i - 1], tokens[i])) {
      result += ' ';
    }
    result += tokens[i].value;
  }
  return result.trim();
}

/**
 * 在顶层（不在括号内）找到指定关键字的位置
 */
function findTopLevelKeyword(tokens: Token[], keyword: string, startIdx: number = 0): number {
  let depth = 0;
  for (let i = startIdx; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === TokenType.LPAREN) depth++;
    else if (t.type === TokenType.RPAREN) depth--;
    else if (depth === 0 && t.type === TokenType.KEYWORD && t.value.toLowerCase() === keyword) {
      return i;
    }
  }
  return -1;
}

/**
 * 在顶层找到指定关键字序列的位置（如 "group by", "order by"）
 */
function findTopLevelKeywordPair(tokens: Token[], kw1: string, kw2: string, startIdx: number = 0): number {
  let depth = 0;
  for (let i = startIdx; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === TokenType.LPAREN) depth++;
    else if (t.type === TokenType.RPAREN) depth--;
    else if (depth === 0 && t.type === TokenType.KEYWORD && t.value.toLowerCase() === kw1) {
      // 检查下一个有意义的 token
      for (let j = i + 1; j < tokens.length; j++) {
        if (tokens[j].type === TokenType.WHITESPACE || tokens[j].type === TokenType.NEWLINE) continue;
        if (tokens[j].type === TokenType.KEYWORD && tokens[j].value.toLowerCase() === kw2) {
          return i;
        }
        break;
      }
    }
  }
  return -1;
}

/**
 * 在顶层按逗号分割 token 列表
 */
function splitByTopLevelComma(tokens: Token[]): Token[][] {
  const result: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;

  for (const t of tokens) {
    if (t.type === TokenType.LPAREN) depth++;
    else if (t.type === TokenType.RPAREN) depth--;
    
    if (depth === 0 && t.type === TokenType.COMMA) {
      result.push(current);
      current = [];
    } else {
      current.push(t);
    }
  }
  if (current.length > 0) {
    result.push(current);
  }
  return result;
}

/**
 * 解析 SELECT 列，识别别名
 * 关键：只在顶层（括号深度 === 0）识别 AS 关键字
 */
function parseSelectColumn(tokens: Token[]): SelectColumn {
  const sig = significantTokens(tokens);
  
  // 从后往前找 AS 关键字（必须在顶层，即不在括号内）
  let depth = 0;
  let asIdx = -1;
  for (let i = sig.length - 1; i >= 0; i--) {
    const t = sig[i];
    if (t.type === TokenType.RPAREN) depth++;
    else if (t.type === TokenType.LPAREN) depth--;
    else if (depth === 0 && t.type === TokenType.KEYWORD && t.value.toLowerCase() === 'as') {
      asIdx = i;
      break;
    }
  }

  if (asIdx >= 0 && asIdx < sig.length - 1) {
    const exprTokens = sig.slice(0, asIdx);
    const aliasTokens = sig.slice(asIdx + 1);
    return {
      expression: tokensToText(exprTokens),
      alias: tokensToText(aliasTokens),
      hasAs: true,
    };
  }

  // 没有 AS，检查是否有隐式别名
  if (sig.length >= 2) {
    const last = sig[sig.length - 1];
    const secondLast = sig[sig.length - 2];
    if (last.type === TokenType.IDENTIFIER && 
        secondLast.type !== TokenType.DOT &&
        secondLast.type !== TokenType.LPAREN &&
        secondLast.type !== TokenType.OPERATOR &&
        secondLast.type !== TokenType.COMMA) {
      if (secondLast.type === TokenType.RPAREN || secondLast.type === TokenType.IDENTIFIER || secondLast.type === TokenType.STRING || secondLast.type === TokenType.NUMBER) {
        const exprTokens = sig.slice(0, sig.length - 1);
        return {
          expression: tokensToText(exprTokens),
          alias: last.value,
          hasAs: false,
        };
      }
    }
  }

  return {
    expression: tokensToText(sig),
    hasAs: false,
  };
}

/**
 * 解析 WHERE 条件，在顶层 AND/OR 处分割
 */
function parseWhereConditions(tokens: Token[]): WhereCondition[] {
  const conditions: WhereCondition[] = [];
  let current: Token[] = [];
  let depth = 0;
  let currentConnector = '';

  for (const t of tokens) {
    if (t.type === TokenType.LPAREN) depth++;
    else if (t.type === TokenType.RPAREN) depth--;

    if (depth === 0 && t.type === TokenType.KEYWORD &&
        (t.value.toLowerCase() === 'and' || t.value.toLowerCase() === 'or')) {
      // 遇到顶层 AND/OR，将当前累积的 token 作为一个条件
      if (current.length > 0) {
        conditions.push({
          connector: currentConnector,
          expression: tokensToText(significantTokens(current)),
        });
      }
      current = [];
      currentConnector = t.value.toLowerCase();
    } else {
      current.push(t);
    }
  }

  // 处理最后一个条件
  if (current.length > 0) {
    conditions.push({
      connector: currentConnector,
      expression: tokensToText(significantTokens(current)),
    });
  }

  return conditions.filter(c => c.expression.length > 0);
}

/**
 * 主解析入口：解析 SQL 查询
 */
export function parseQuery(sql: string): ParsedQuery {
  const allTokens = tokenize(sql);
  const tokens = significantTokens(allTokens);
  
  const result: ParsedQuery = {
    clauses: [],
    raw: sql,
  };

  // 找到各子句的位置
  const selectIdx = findTopLevelKeyword(tokens, 'select');
  const fromIdx = findTopLevelKeyword(tokens, 'from', selectIdx >= 0 ? selectIdx + 1 : 0);
  const whereIdx = findTopLevelKeyword(tokens, 'where', fromIdx >= 0 ? fromIdx + 1 : 0);
  const groupByIdx = findTopLevelKeywordPair(tokens, 'group', 'by');
  const havingIdx = findTopLevelKeyword(tokens, 'having');
  const orderByIdx = findTopLevelKeywordPair(tokens, 'order', 'by');
  const limitIdx = findTopLevelKeyword(tokens, 'limit');

  // 确定各子句的结束位置
  const clauseStarts = [
    { name: 'select', idx: selectIdx },
    { name: 'from', idx: fromIdx },
    { name: 'where', idx: whereIdx },
    { name: 'group_by', idx: groupByIdx },
    { name: 'having', idx: havingIdx },
    { name: 'order_by', idx: orderByIdx },
    { name: 'limit', idx: limitIdx },
  ].filter(c => c.idx >= 0).sort((a, b) => a.idx - b.idx);

  function getClauseEnd(clauseIndex: number): number {
    for (let i = clauseIndex + 1; i < clauseStarts.length; i++) {
      if (clauseStarts[i].idx > clauseStarts[clauseIndex].idx) {
        return clauseStarts[i].idx;
      }
    }
    // 去掉末尾的 EOF 和分号
    let end = tokens.length;
    while (end > 0 && (tokens[end - 1].type === TokenType.EOF || tokens[end - 1].type === TokenType.SEMICOLON)) {
      end--;
    }
    return end;
  }

  // 解析 SELECT
  if (selectIdx >= 0) {
    const clauseIdx = clauseStarts.findIndex(c => c.name === 'select');
    const endIdx = getClauseEnd(clauseIdx);
    
    // SELECT 后面可能有 DISTINCT
    let colStart = selectIdx + 1;
    if (colStart < endIdx && tokens[colStart].type === TokenType.KEYWORD && tokens[colStart].value.toLowerCase() === 'distinct') {
      colStart++;
    }

    const columnTokens = tokens.slice(colStart, endIdx);
    const columnGroups = splitByTopLevelComma(columnTokens);
    
    result.select = {
      columns: columnGroups.map(g => parseSelectColumn(g)),
    };
    result.clauses.push({ type: 'select', raw: tokensToText(tokens.slice(selectIdx, endIdx)) });
  }

  // 解析 FROM
  if (fromIdx >= 0) {
    const clauseIdx = clauseStarts.findIndex(c => c.name === 'from');
    const endIdx = getClauseEnd(clauseIdx);
    const fromTokens = tokens.slice(fromIdx + 1, endIdx);
    result.from = { tables: tokensToText(fromTokens) };
    result.clauses.push({ type: 'from', raw: tokensToText(tokens.slice(fromIdx, endIdx)) });
  }

  // 解析 WHERE
  if (whereIdx >= 0) {
    const clauseIdx = clauseStarts.findIndex(c => c.name === 'where');
    const endIdx = getClauseEnd(clauseIdx);
    const whereTokens = tokens.slice(whereIdx + 1, endIdx);
    result.where = { conditions: parseWhereConditions(whereTokens) };
    result.clauses.push({ type: 'where', raw: tokensToText(tokens.slice(whereIdx, endIdx)) });
  }

  // 解析 GROUP BY
  if (groupByIdx >= 0) {
    const clauseIdx = clauseStarts.findIndex(c => c.name === 'group_by');
    const endIdx = getClauseEnd(clauseIdx);
    let start = groupByIdx + 1;
    while (start < endIdx && tokens[start].type === TokenType.KEYWORD && tokens[start].value.toLowerCase() === 'by') {
      start++;
    }
    const colTokens = tokens.slice(start, endIdx);
    const groups = splitByTopLevelComma(colTokens);
    result.groupBy = { columns: groups.map(g => tokensToText(g)) };
    result.clauses.push({ type: 'group_by', raw: tokensToText(tokens.slice(groupByIdx, endIdx)) });
  }

  // 解析 HAVING
  if (havingIdx >= 0) {
    const clauseIdx = clauseStarts.findIndex(c => c.name === 'having');
    const endIdx = getClauseEnd(clauseIdx);
    const havingTokens = tokens.slice(havingIdx + 1, endIdx);
    result.having = { conditions: parseWhereConditions(havingTokens) };
    result.clauses.push({ type: 'having', raw: tokensToText(tokens.slice(havingIdx, endIdx)) });
  }

  // 解析 ORDER BY
  if (orderByIdx >= 0) {
    const clauseIdx = clauseStarts.findIndex(c => c.name === 'order_by');
    const endIdx = getClauseEnd(clauseIdx);
    let start = orderByIdx + 1;
    while (start < endIdx && tokens[start].type === TokenType.KEYWORD && tokens[start].value.toLowerCase() === 'by') {
      start++;
    }
    const colTokens = tokens.slice(start, endIdx);
    const groups = splitByTopLevelComma(colTokens);
    result.orderBy = { columns: groups.map(g => tokensToText(g)) };
    result.clauses.push({ type: 'order_by', raw: tokensToText(tokens.slice(orderByIdx, endIdx)) });
  }

  // 解析 LIMIT
  if (limitIdx >= 0) {
    const clauseIdx = clauseStarts.findIndex(c => c.name === 'limit');
    const endIdx = getClauseEnd(clauseIdx);
    const limitTokens = tokens.slice(limitIdx + 1, endIdx);
    result.limit = tokensToText(limitTokens);
    result.clauses.push({ type: 'limit', raw: tokensToText(tokens.slice(limitIdx, endIdx)) });
  }

  return result;
}
