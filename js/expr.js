/* ==========================================================================
   expr.js —— 数学表达式解析器
   把 "sin(x) + x^2/4" 这类字符串编译成 f(x)，纯逻辑，可在 Node 里测试
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Expr = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CONSTANTS = {
    pi: Math.PI,
    'π': Math.PI,
    e: Math.E,
    tau: Math.PI * 2
  };

  var FUNCS = {
    sin: { arity: 1, fn: Math.sin },
    cos: { arity: 1, fn: Math.cos },
    tan: { arity: 1, fn: Math.tan },
    asin: { arity: 1, fn: Math.asin },
    acos: { arity: 1, fn: Math.acos },
    atan: { arity: 1, fn: Math.atan },
    sinh: { arity: 1, fn: Math.sinh },
    cosh: { arity: 1, fn: Math.cosh },
    tanh: { arity: 1, fn: Math.tanh },
    sqrt: { arity: 1, fn: Math.sqrt },
    cbrt: { arity: 1, fn: Math.cbrt },
    abs: { arity: 1, fn: Math.abs },
    exp: { arity: 1, fn: Math.exp },
    ln: { arity: 1, fn: Math.log },
    log: { arity: 1, fn: Math.log10 },
    log2: { arity: 1, fn: Math.log2 },
    floor: { arity: 1, fn: Math.floor },
    ceil: { arity: 1, fn: Math.ceil },
    round: { arity: 1, fn: Math.round },
    sign: { arity: 1, fn: Math.sign },
    min: { arity: 2, fn: Math.min },
    max: { arity: 2, fn: Math.max },
    pow: { arity: 2, fn: Math.pow }
  };

  var FULLWIDTH = {
    '（': '(', '）': ')', '，': ',', '。': '.',
    '＋': '+', '－': '-', '—': '-', '–': '-',
    '＊': '*', '×': '*', '／': '/', '÷': '/',
    '＾': '^', '＝': '=', '　': ' '
  };

  function normalize(src) {
    var s = String(src);
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      var code = ch.charCodeAt(0);
      if (code >= 0xFF10 && code <= 0xFF19) {
        out += String.fromCharCode(code - 0xFF10 + 48);
      } else if (FULLWIDTH[ch]) {
        out += FULLWIDTH[ch];
      } else {
        out += ch;
      }
    }
    /* 去掉 "y =" / "f(x) =" 前缀 */
    return out.replace(/^\s*(?:y|f\s*\(\s*x\s*\))\s*=\s*/i, '');
  }

  /* ---------------- 词法 ---------------- */

  function tokenize(src) {
    var s = src;
    var i = 0;
    var tokens = [];

    while (i < s.length) {
      var ch = s[i];

      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        i++;
        continue;
      }

      if (ch >= '0' && ch <= '9' || ch === '.') {
        var start = i;
        var dots = 0;
        while (i < s.length && ((s[i] >= '0' && s[i] <= '9') || s[i] === '.')) {
          if (s[i] === '.') dots++;
          i++;
        }
        if (dots > 1) throw new Error('数字格式不对');
        /* 科学计数法：1e3 / 1e-3 / 2.5e+2（必须紧跟数字，2e 仍然表示 2×e） */
        if (i < s.length && (s[i] === 'e' || s[i] === 'E')) {
          var j = i + 1;
          if (s[j] === '+' || s[j] === '-') j++;
          if (s[j] >= '0' && s[j] <= '9') {
            j++;
            while (j < s.length && s[j] >= '0' && s[j] <= '9') j++;
            i = j;
          }
        }
        var text = s.slice(start, i);
        if (text === '.') throw new Error('这里缺一个数字');
        tokens.push({ type: 'num', value: parseFloat(text) });
        continue;
      }

      if (/[a-zA-Z_π]/.test(ch)) {
        var st = i;
        i++;
        while (i < s.length && /[a-zA-Z0-9_π]/.test(s[i])) i++;
        tokens.push({ type: 'name', value: s.slice(st, i).toLowerCase() });
        continue;
      }

      if (ch === '*' && s[i + 1] === '*') {
        tokens.push({ type: 'op', value: '^' });
        i += 2;
        continue;
      }

      if ('+-*/^(),'.indexOf(ch) >= 0) {
        tokens.push({ type: 'op', value: ch });
        i++;
        continue;
      }

      throw new Error('看不懂的字符「' + ch + '」');
    }

    return tokens;
  }

  /* ---------------- 语法 ---------------- */

  function Parser(tokens) {
    this.tokens = tokens;
    this.i = 0;
  }

  Parser.prototype.peek = function () {
    return this.tokens[this.i] || null;
  };

  Parser.prototype.next = function () {
    return this.tokens[this.i++] || null;
  };

  Parser.prototype.isOp = function (value) {
    var t = this.peek();
    return !!t && t.type === 'op' && t.value === value;
  };

  Parser.prototype.expect = function (value) {
    var t = this.next();
    if (!t || t.type !== 'op' || t.value !== value) {
      throw new Error('这里需要「' + value + '」');
    }
  };

  /* 表达式：项 (('+'|'-') 项)* */
  Parser.prototype.parseExpr = function () {
    var node = this.parseTerm();
    while (this.isOp('+') || this.isOp('-')) {
      var op = this.next().value;
      node = { type: 'bin', op: op, left: node, right: this.parseTerm() };
    }
    return node;
  };

  /* 项：一元 (('*'|'/'|隐式乘法) 一元)* */
  Parser.prototype.parseTerm = function () {
    var node = this.parseUnary();
    for (;;) {
      if (this.isOp('*') || this.isOp('/')) {
        var op = this.next().value;
        node = { type: 'bin', op: op, left: node, right: this.parseUnary() };
        continue;
      }
      var t = this.peek();
      var startsAtom = t && (t.type === 'num' || t.type === 'name' || (t.type === 'op' && t.value === '('));
      if (startsAtom) {
        node = { type: 'bin', op: '*', left: node, right: this.parseUnary() };
        continue;
      }
      break;
    }
    return node;
  };

  /* 一元：(-|+) 一元 | 幂 */
  Parser.prototype.parseUnary = function () {
    if (this.isOp('-')) {
      this.next();
      return { type: 'neg', arg: this.parseUnary() };
    }
    if (this.isOp('+')) {
      this.next();
      return this.parseUnary();
    }
    return this.parsePower();
  };

  /* 幂：原子 ('^' 一元)? —— 右结合，-x^2 = -(x^2)，2^-3 合法 */
  Parser.prototype.parsePower = function () {
    var base = this.parseAtom();
    if (this.isOp('^')) {
      this.next();
      return { type: 'bin', op: '^', left: base, right: this.parseUnary() };
    }
    return base;
  };

  /* 原子：数字 | 常量 | 变量 | 函数(...) | (表达式) */
  Parser.prototype.parseAtom = function () {
    var t = this.next();
    if (!t) throw new Error('表达式没写完');

    if (t.type === 'num') return { type: 'num', value: t.value };

    if (t.type === 'name') {
      var name = t.value;

      /* 只有已知函数名后面跟括号才算调用：e(x+1) 里的 e 是常数 */
      if (FUNCS[name] && this.isOp('(')) {
        this.next();
        var args = [this.parseExpr()];
        while (this.isOp(',')) {
          this.next();
          args.push(this.parseExpr());
        }
        this.expect(')');
        var def = FUNCS[name];
        if (args.length !== def.arity) {
          throw new Error(name + ' 需要 ' + def.arity + ' 个参数');
        }
        return { type: 'call', name: name, args: args };
      }

      if (Object.prototype.hasOwnProperty.call(CONSTANTS, name)) {
        return { type: 'num', value: CONSTANTS[name] };
      }
      if (name === 'x') return { type: 'var', name: 'x' };
      if (FUNCS[name]) throw new Error(name + ' 后面需要括号，比如 ' + name + '(x)');
      throw new Error('不认识「' + name + '」');
    }

    if (t.type === 'op' && t.value === '(') {
      var inner = this.parseExpr();
      this.expect(')');
      return inner;
    }

    throw new Error('这里不该出现「' + t.value + '」');
  };

  /* ---------------- 编译成函数 ---------------- */

  function compileNode(node) {
    switch (node.type) {
      case 'num':
        var value = node.value;
        return function () { return value; };

      case 'var':
        return function (x) { return x; };

      case 'neg':
        var argF = compileNode(node.arg);
        return function (x) { return -argF(x); };

      case 'bin':
        var l = compileNode(node.left);
        var r = compileNode(node.right);
        if (node.op === '+') return function (x) { return l(x) + r(x); };
        if (node.op === '-') return function (x) { return l(x) - r(x); };
        if (node.op === '*') return function (x) { return l(x) * r(x); };
        if (node.op === '/') return function (x) { return l(x) / r(x); };
        if (node.op === '^') return function (x) { return Math.pow(l(x), r(x)); };
        throw new Error('未知运算符 ' + node.op);

      case 'call':
        var def = FUNCS[node.name];
        if (def.arity === 1) {
          var a1 = compileNode(node.args[0]);
          var f1 = def.fn;
          return function (x) { return f1(a1(x)); };
        }
        var b1 = compileNode(node.args[0]);
        var b2 = compileNode(node.args[1]);
        var f2 = def.fn;
        return function (x) { return f2(b1(x), b2(x)); };

      default:
        throw new Error('未知节点 ' + node.type);
    }
  }

  /**
   * compile('sin(x)+1')
   *   -> { ok: true, fn: function(x){...}, source: 'sin(x)+1' }
   *   -> { ok: false, error: '...' }
   */
  function compile(source) {
    var src = normalize(source);
    if (!src.trim()) return { ok: false, error: '请输入表达式' };
    try {
      var tokens = tokenize(src);
      if (!tokens.length) return { ok: false, error: '请输入表达式' };
      var parser = new Parser(tokens);
      var ast = parser.parseExpr();
      if (parser.i < tokens.length) {
        var extra = tokens[parser.i];
        throw new Error('多余的内容「' + (extra.value !== undefined ? extra.value : extra.type) + '」');
      }
      return { ok: true, fn: compileNode(ast), ast: ast, source: src };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  function evaluate(source, x) {
    var r = compile(source);
    if (!r.ok) return NaN;
    return r.fn(x);
  }

  return {
    compile: compile,
    evaluate: evaluate,
    tokenize: tokenize,
    normalize: normalize,
    FUNCS: FUNCS,
    CONSTANTS: CONSTANTS
  };
}));
