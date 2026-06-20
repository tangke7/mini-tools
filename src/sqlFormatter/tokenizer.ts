/**
 * SQL Tokenizer - 词法分析器
 * 将 SQL 字符串拆分为 token 序列
 */

export const TokenType = {
  KEYWORD: 'KEYWORD',
  IDENTIFIER: 'IDENTIFIER',
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  OPERATOR: 'OPERATOR',
  COMMA: 'COMMA',
  DOT: 'DOT',
  LPAREN: 'LPAREN',
  RPAREN: 'RPAREN',
  WHITESPACE: 'WHITESPACE',
  NEWLINE: 'NEWLINE',
  COMMENT: 'COMMENT',
  STAR: 'STAR',
  SEMICOLON: 'SEMICOLON',
  EOF: 'EOF',
} as const;

export type TokenType = (typeof TokenType)[keyof typeof TokenType];

export interface Token {
  type: TokenType;
  value: string;
  position: number;
}

const SQL_KEYWORDS = new Set([
  'select', 'from', 'where', 'and', 'or', 'not', 'in', 'is', 'null',
  'as', 'on', 'join', 'left', 'right', 'inner', 'outer', 'full', 'cross',
  'group', 'by', 'order', 'asc', 'desc', 'having', 'limit', 'offset',
  'union', 'all', 'distinct', 'insert', 'into', 'values', 'update', 'set',
  'delete', 'create', 'table', 'drop', 'alter', 'index', 'view',
  'if', 'exists', 'between', 'like', 'case', 'when', 'then', 'else', 'end',
  'cast', 'with', 'recursive', 'over', 'partition', 'row', 'rows',
  'window', 'unbounded', 'preceding', 'following', 'current', 'range',
  'true', 'false', 'primary', 'key', 'foreign', 'references', 'constraint',
  'default', 'check', 'unique', 'grant', 'revoke', 'to',
  'lateral', 'unnest', 'tablesample', 'cube', 'rollup', 'grouping',
]);

// 常见 SQL 函数名也标记为标识符而非关键字
const SQL_FUNCTIONS = new Set([
  'count', 'sum', 'avg', 'min', 'max', 'coalesce', 'nullif', 'ifnull',
  'concat', 'substring', 'substr', 'trim', 'upper', 'lower', 'length',
  'replace', 'lpad', 'rpad', 'reverse', 'split', 'regexp_replace',
  'abs', 'ceil', 'floor', 'round', 'mod', 'power', 'sqrt', 'log',
  'date', 'year', 'month', 'day', 'hour', 'minute', 'second',
  'now', 'current_date', 'current_timestamp', 'date_add', 'date_sub',
  'datediff', 'date_format', 'from_unixtime', 'unix_timestamp', 'to_date',
  'get_json_object', 'json_extract', 'json_value', 'json_query',
  'row_number', 'rank', 'dense_rank', 'ntile', 'lag', 'lead',
  'first_value', 'last_value', 'nth_value',
  'collect_list', 'collect_set', 'array', 'map', 'struct',
  'explode', 'posexplode', 'inline',
  'if', 'nvl', 'nvl2', 'decode',
  'regexp_extract', 'parse_url', 'reflect',
  'size', 'array_contains', 'sort_array', 'map_keys', 'map_values',
]);

export function isKeyword(word: string): boolean {
  return SQL_KEYWORDS.has(word.toLowerCase());
}

export function isSqlFunction(word: string): boolean {
  return SQL_FUNCTIONS.has(word.toLowerCase());
}

export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  while (pos < sql.length) {
    const ch = sql[pos];

    // 空白字符（不含换行）
    if (ch === ' ' || ch === '\t') {
      const start = pos;
      while (pos < sql.length && (sql[pos] === ' ' || sql[pos] === '\t')) {
        pos++;
      }
      tokens.push({ type: TokenType.WHITESPACE, value: sql.slice(start, pos), position: start });
      continue;
    }

    // 换行
    if (ch === '\n' || ch === '\r') {
      const start = pos;
      if (ch === '\r' && pos + 1 < sql.length && sql[pos + 1] === '\n') {
        pos += 2;
      } else {
        pos++;
      }
      tokens.push({ type: TokenType.NEWLINE, value: sql.slice(start, pos), position: start });
      continue;
    }

    // 单行注释 --
    if (ch === '-' && pos + 1 < sql.length && sql[pos + 1] === '-') {
      const start = pos;
      while (pos < sql.length && sql[pos] !== '\n') {
        pos++;
      }
      tokens.push({ type: TokenType.COMMENT, value: sql.slice(start, pos), position: start });
      continue;
    }

    // 多行注释 /* */
    if (ch === '/' && pos + 1 < sql.length && sql[pos + 1] === '*') {
      const start = pos;
      pos += 2;
      while (pos < sql.length && !(sql[pos] === '*' && pos + 1 < sql.length && sql[pos + 1] === '/')) {
        pos++;
      }
      if (pos < sql.length) pos += 2;
      tokens.push({ type: TokenType.COMMENT, value: sql.slice(start, pos), position: start });
      continue;
    }

    // 字符串 (单引号)
    if (ch === "'") {
      const start = pos;
      pos++;
      while (pos < sql.length) {
        if (sql[pos] === "'" && pos + 1 < sql.length && sql[pos + 1] === "'") {
          pos += 2; // 转义的单引号
        } else if (sql[pos] === "'") {
          pos++;
          break;
        } else {
          pos++;
        }
      }
      tokens.push({ type: TokenType.STRING, value: sql.slice(start, pos), position: start });
      continue;
    }

    // 字符串 (双引号 / 标识符引用)
    if (ch === '"') {
      const start = pos;
      pos++;
      while (pos < sql.length && sql[pos] !== '"') {
        pos++;
      }
      if (pos < sql.length) pos++;
      tokens.push({ type: TokenType.IDENTIFIER, value: sql.slice(start, pos), position: start });
      continue;
    }

    // 反引号标识符
    if (ch === '`') {
      const start = pos;
      pos++;
      while (pos < sql.length && sql[pos] !== '`') {
        pos++;
      }
      if (pos < sql.length) pos++;
      tokens.push({ type: TokenType.IDENTIFIER, value: sql.slice(start, pos), position: start });
      continue;
    }

    // 数字
    if (/[0-9]/.test(ch)) {
      const start = pos;
      while (pos < sql.length && /[0-9.]/.test(sql[pos])) {
        pos++;
      }
      // 支持科学计数法
      if (pos < sql.length && (sql[pos] === 'e' || sql[pos] === 'E')) {
        pos++;
        if (pos < sql.length && (sql[pos] === '+' || sql[pos] === '-')) {
          pos++;
        }
        while (pos < sql.length && /[0-9]/.test(sql[pos])) {
          pos++;
        }
      }
      tokens.push({ type: TokenType.NUMBER, value: sql.slice(start, pos), position: pos });
      continue;
    }

    // 标识符和关键字
    if (/[a-zA-Z_$]/.test(ch)) {
      const start = pos;
      while (pos < sql.length && /[a-zA-Z0-9_$.]/.test(sql[pos])) {
        // 允许点号在标识符中（如 table.column, $.json.path）
        if (sql[pos] === '.' && pos + 1 < sql.length && /[a-zA-Z_$]/.test(sql[pos + 1])) {
          pos++;
        } else if (sql[pos] === '.') {
          break;
        } else {
          pos++;
        }
      }
      const word = sql.slice(start, pos);
      const lowerWord = word.toLowerCase();
      
      if (isKeyword(lowerWord) && !isSqlFunction(lowerWord)) {
        tokens.push({ type: TokenType.KEYWORD, value: word, position: start });
      } else {
        tokens.push({ type: TokenType.IDENTIFIER, value: word, position: start });
      }
      continue;
    }

    // 特殊字符
    if (ch === '(') {
      tokens.push({ type: TokenType.LPAREN, value: ch, position: pos });
      pos++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: TokenType.RPAREN, value: ch, position: pos });
      pos++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: TokenType.COMMA, value: ch, position: pos });
      pos++;
      continue;
    }
    if (ch === '.') {
      tokens.push({ type: TokenType.DOT, value: ch, position: pos });
      pos++;
      continue;
    }
    if (ch === '*') {
      tokens.push({ type: TokenType.STAR, value: ch, position: pos });
      pos++;
      continue;
    }
    if (ch === ';') {
      tokens.push({ type: TokenType.SEMICOLON, value: ch, position: pos });
      pos++;
      continue;
    }

    // 多字符运算符
    if (pos + 1 < sql.length) {
      const two = sql.slice(pos, pos + 2);
      if (['>=', '<=', '<>', '!=', '||', '&&', '<<', '>>', '::'].includes(two)) {
        tokens.push({ type: TokenType.OPERATOR, value: two, position: pos });
        pos += 2;
        continue;
      }
    }

    // 单字符运算符
    if (['+', '-', '/', '%', '=', '<', '>', '!', '|', '&', '^', '~'].includes(ch)) {
      tokens.push({ type: TokenType.OPERATOR, value: ch, position: pos });
      pos++;
      continue;
    }

    // 未知字符直接跳过
    pos++;
  }

  tokens.push({ type: TokenType.EOF, value: '', position: pos });
  return tokens;
}
