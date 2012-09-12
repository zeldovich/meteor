
var allNodeNames = [
  ";",
  "array",
  "assignment",
  "binary",
  "blockStmnt",
  "boolean",
  "bracket",
  "breakStmnt",
  "call",
  "case",
  "catch",
  "comma",
  "continueStmnt",
  "debuggerStmnt",
  "default",
  "doStmnt",
  "dot",
  "emptyStmnt",
  "expressionStmnt",
  "finally",
  "forInSpec",
  "forSpec",
  "forStmnt",
  "forVarInSpec",
  "forVarSpec",
  "functionDecl",
  "functionExpr",
  "idPropName",
  "identifier",
  "ifStmnt",
  "labelStmnt",
  "new",
  "newcall",
  "nil",
  "null",
  "numPropName",
  "number",
  "object",
  "parens",
  "postfix",
  "program",
  "prop",
  "regex",
  "returnStmnt",
  "strPropName",
  "string",
  "switchStmnt",
  "ternary",
  "this",
  "throwStmnt",
  "tryStmnt",
  "unary",
  "varDecl",
  "varStmnt",
  "whileStmnt",
  "withStmnt"
];

var allNodeNamesSet = {};
_.each(allNodeNames, function (n) { allNodeNamesSet[n] = true; });

// The "tree string" format is a simple format for representing syntax trees.
//
// For example, the parse of `x++;` is written as:
// "program(expressionStmnt(postfix(identifier(x) ++) ;))"
//
// A Node is written as "name(item1 item2 item3)", with additional whitespace
// allowed anywhere between the name, parentheses, and items.
//
// Tokens don't need to be escaped unless they contain '(', ')', whitespace, or
// backticks.  If they do, they can be written enclosed in backticks.  To escape
// a backtick within backticks, double it.
//
// `stringifyTree` generates "canonical" tree strings, which have no extra escaping
// or whitespace, just one space between items in a Node.

var parseTreeString = function (str) {
  var results = [];
  var ptrStack = [];
  var ptr = results;
  _.each(str.match(/\(|\)|`([^`]||``)*`|`|[^\s()`]+/g), function (txt) {
    switch (txt.charAt(0)) {
    case '(':
      if (! ptr.length || (typeof ptr[ptr.length - 1] !== "string"))
        throw new Error("Nameless node in " + str);
      var newArray = [ptr.pop()];
      ptr.push(newArray);
      ptrStack.push(ptr);
      ptr = newArray;
      break;
    case ')':
      ptr = ptrStack.pop();
      var nodeArray = ptr.pop();
      ptr.push(new ParseNode(nodeArray[0], nodeArray.slice(1)));
      break;
    case '`':
      if (txt.length === 1)
        throw new Error("Mismatched ` in " + str);
      ptr.push(txt.slice(1, -1).replace(/``/g, '`'));
      break;
    default:
      ptr.push(txt);
      break;
    }
    if (results.length > 1)
      throw new Error("Not expecting " + txt + " in " + str);
  });
  if (ptr !== results)
    throw new Error("Mismatched parentheses in " + str);
  return results[0];
};
var escapeTokenString = function (str) {
  if (/[\s()`]/.test(str))
    return '`' + str.replace(/`/g, '``') + '`';
  else
    return str;
};
var stringifyTree = function (tree) {
  if (tree instanceof ParseNode)
    return (escapeTokenString(tree.name) + '(' +
            _.map(tree.children, stringifyTree).join(' ') +
            ')');

  // Treat a token object or string as a token.
  if (tree.text)
    tree = tree.text;
  return escapeTokenString(tree);
};

var parseToTreeString = function (code) {
  var lexer = new Lexer(code);
  var tokenizer = new Tokenizer(code);
  var tree = parse(tokenizer);
  return stringifyTree(tree);
};

var makeTester = function (test) {
  return {
    // Parse code and make sure it matches expectedTreeString.
    goodParse: function (code, expectedTreeString, regexTokenHints) {
      var expectedTree = parseTreeString(expectedTreeString);

      // first use lexer to collect all tokens
      var lexer = new Lexer(code);
      var allTokensInOrder = [];
      while (lexer.next() !== 'EOF') {
        if (lexer.type === 'ERROR')
          test.fail("Lexer error at " + lexer.lastPos);
        if (Lexer.isToken(lexer.type))
          allTokensInOrder.push({ pos: lexer.lastPos, text: lexer.text });
        if (regexTokenHints && regexTokenHints[allTokensInOrder.length])
          lexer.divisionPermitted = false;
      }
      lexer = new Lexer(code);

      var tokenizer = new Tokenizer(code);
      var actualTree = parse(tokenizer);

      var nextTokenIndex = 0;
      var check = function (tree) {
        if (tree instanceof ParseNode) {
          // This is a NODE (non-terminal).
          var nodeName = tree.name;
          if (! (nodeName && typeof nodeName === "string" &&
                 allNodeNamesSet[nodeName] === true))
            test.fail("Not a node name: " + nodeName);
          _.each(tree.children, check);
        } else if (typeof tree === 'object' && tree.text &&
                   (typeof tree.pos === 'number')) {
          // This is a TOKEN (terminal).
          // Make sure we are visiting every token once, in order.
          if (nextTokenIndex >= allTokensInOrder.length)
            test.fail("Too many tokens: " + (nextTokenIndex + 1));
          var referenceToken = allTokensInOrder[nextTokenIndex++];
          if (tree.text !== referenceToken.text)
            test.fail(tree.text + " !== " + referenceToken.text);
          if (tree.pos !== referenceToken.pos)
            test.fail(tree.pos + " !== " + referenceToken.pos);
          if (code.substring(tree.pos,
                             tree.pos + tree.text.length) !== tree.text)
            test.fail("Didn't see " + tree.text + " at " + tree.pos +
                      " in " + code);
        } else {
          test.fail("Unknown tree part: " + tree);
        }
      };

      check(actualTree);
      if (nextTokenIndex !== allTokensInOrder.length)
        test.fail("Too few tokens: " + nextTokenIndex);

      test.equal(stringifyTree(actualTree),
                 stringifyTree(expectedTree), code);
    },
    // Takes code with part of it surrounding with backticks.
    // Removes the two backtick characters, tries to parse the code,
    // and then asserts that there was a tokenization-level error,
    // with the part that was between the backticks called out as
    // the bad token.
    //
    // For example, the test "123`@`" will try to parse "123@" and
    // assert that a tokenization error occurred at '@'.
    badToken: function (code) {
      var constructMessage = function (pos, text) {
        return "Bad token at position " + pos + ", text `" + text + "`";
      };
      var pos = code.indexOf('`');
      var text = code.match(/`(.*?)`/)[1];
      code = code.replace(/`/g, '');

      var parsed = false;
      var error = null;
      try {
        var lexer = new Lexer(code);
        var tokenizer = new Tokenizer(code);
        var tree = parse(tokenizer);
        parsed = true;
      } catch (e) {
        error = e;
      }
      test.isFalse(parsed);
      test.isTrue(error);
      test.equal(error.message, constructMessage(pos, text));
    },
    // Takes code with a backtick-quoted string embedded in it.
    // Removes the backticks and their contents, tries to parse the code,
    // and then asserts that there was a parse error at the location
    // where the backtick-quoted string was embedded.  The embedded
    // string must match whatever the error message says was "expected".
    //
    // For example, the test "{`statement`" will try to parse the code
    // "{" and then assert that an error occured at the end of the string
    // saying "Expected statement".  The test "1 `semicolon`2" will try
    // to parse "1 2" and assert that the error "Expected semicolon"
    // appeared after the space and before the 2.
    //
    // A second backtick-quoted string is used as the "found" token
    // in the error message.
    badParse: function (code) {
      var constructMessage = function (whatExpected, pos, found, after) {
        return "Expected " + whatExpected + " after `" + after +
          "` at position " + pos + ", found " + found;
      };
      var pos = code.indexOf('`');

      var backticked = code.match(/`.*?`/g);
      var whatExpected = backticked[0] && backticked[0].slice(1,-1);
      var found = backticked[1] && backticked[1].slice(1, -1);
      code = code.replace(/`.*?`/g, '');

      var parsed = false;
      var error = null;
      try {
        var lexer = new Lexer(code);
        var tokenizer = new Tokenizer(code);
        var tree = parse(tokenizer);
        parsed = true;
      } catch (e) {
        error = e;
      }
      test.isFalse(parsed);
      test.isTrue(error);
      var after = tokenizer.text;
      found = (found || (tokenizer.peekText ? '`' + tokenizer.peekText + '`'
                         : 'EOF'));
      test.equal(error.message,
                 constructMessage(whatExpected, pos, found, after));
    }
  };
};


Tinytest.add("jsparse - basics", function (test) {
  var tester = makeTester(test);
  tester.goodParse('1', "program(expressionStmnt(number(1) ;()))");
  tester.goodParse('1 + 1', "program(expressionStmnt(binary(number(1) + number(1)) ;()))");
  tester.goodParse('1*2+3*4', "program(expressionStmnt(binary(binary(number(1) * number(2)) + " +
                "binary(number(3) * number(4))) ;()))");
  tester.goodParse('1 + 1;', "program(expressionStmnt(binary(number(1) + number(1)) ;))");
  tester.goodParse('1 + 1;;', "program(expressionStmnt(binary(number(1) + number(1)) ;) emptyStmnt(;))");
  tester.goodParse('', "program()");
  tester.goodParse('\n', "program()");
  tester.goodParse(';;;\n\n;\n', "program(emptyStmnt(;) emptyStmnt(;) emptyStmnt(;) emptyStmnt(;))");
  tester.goodParse('foo', "program(expressionStmnt(identifier(foo) ;()))");
  tester.goodParse('foo();', "program(expressionStmnt(call(identifier(foo) `(` `)`) ;))");
  tester.goodParse('var x = 3', "program(varStmnt(var varDecl(x = number(3)) ;()))");
  tester.goodParse('++x;', "program(expressionStmnt(unary(++ identifier(x)) ;))");
  tester.goodParse('x++;', "program(expressionStmnt(postfix(identifier(x) ++) ;))");
  tester.goodParse(
    'throw new Error',
    "program(throwStmnt(throw new(new identifier(Error)) ;()))");
  tester.goodParse(
    'var x = function () { return 123; };',
    'program(varStmnt(var varDecl(x = functionExpr(function nil() `(` `)` ' +
      '{ returnStmnt(return number(123) ;) })) ;))');

  tester.badParse("var x = `expression`");
  tester.badParse("1 `semicolon`1");
  tester.badParse("1+1`semicolon`:");
});

Tinytest.add("jsparse - tokenization errors", function (test) {
  var tester = makeTester(test);
  tester.badToken("123`@`");
  tester.badToken("thisIsATestOf = `'unterminated `\n strings'");
});

Tinytest.add("jsparse - syntax forms", function (test) {
  var tester = makeTester(test);
  var trials = [
    // STATEMENTS
    ['1',
     'program(expressionStmnt(number(1) ;()))'],
    ['1;;;;2',
     'program(expressionStmnt(number(1) ;) emptyStmnt(;) emptyStmnt(;) emptyStmnt(;) ' +
     'expressionStmnt(number(2) ;()))'],
    ['{}',
     'program(blockStmnt({ }))'],
    ['{null}',
     'program(blockStmnt({ expressionStmnt(null(null) ;()) }))'],
    ['{\nfoo()\nbar();\n}',
     'program(blockStmnt({ expressionStmnt(call(identifier(foo) `(` `)`) ;()) ' +
     'expressionStmnt(call(identifier(bar) `(` `)`) ;) }))'],
    ['{{{}}}',
     'program(blockStmnt({ blockStmnt({ blockStmnt({ }) }) }))'],
    ['var x = y, z,\n  a = b = c;',
     'program(varStmnt(var varDecl(x = identifier(y)) , varDecl(z) , varDecl(a = ' +
     'assignment(identifier(b) = identifier(c))) ;))'],
    ['if (x === y);',
     'program(ifStmnt(if `(` binary(identifier(x) === identifier(y)) `)` emptyStmnt(;)))'],
    ['if (z) return',
     'program(ifStmnt(if `(` identifier(z) `)` returnStmnt(return nil() ;())))'],
    ['if (a) b; else c',
     'program(ifStmnt(if `(` identifier(a) `)` expressionStmnt(identifier(b) ;) else ' +
     'expressionStmnt(identifier(c) ;())))'],
    ['if (n === 1) { foo(); } else if (n === 2) { bar(); } else { baz(); }',
     'program(ifStmnt(if `(` binary(identifier(n) === number(1)) `)` blockStmnt(' +
     '{ expressionStmnt(call(identifier(foo) `(` `)`) ;) }) else ifStmnt(' +
     'if `(` binary(identifier(n) === number(2)) `)` blockStmnt(' +
     '{ expressionStmnt(call(identifier(bar) `(` `)`) ;) }) else blockStmnt(' +
     '{ expressionStmnt(call(identifier(baz) `(` `)`) ;) }))))'],
    ['while (false);',
     'program(whileStmnt(while `(` boolean(false) `)` emptyStmnt(;)))'],
    ['while (/foo/.test(bar.baz)) {\n  bar = bar.baz;\n}',
     'program(whileStmnt(while `(` call(dot(regex(/foo/) . test) `(` ' +
     'dot(identifier(bar) . baz) `)`) `)` blockStmnt({ expressionStmnt(' +
     'assignment(identifier(bar) = dot(identifier(bar) . baz)) ;) })))'],
    ['while (false) while (false);',
     'program(whileStmnt(while `(` boolean(false) `)` ' +
     'whileStmnt(while `(` boolean (false) `)` emptyStmnt(;))))'],
    ['do a; while (b);',
     'program(doStmnt(do expressionStmnt(identifier(a) ;) while `(` identifier(b) `)` ;))'],
    ['do { x-- } while (x);',
     'program(doStmnt(do blockStmnt({ expressionStmnt(postfix(identifier(x) --) ;()) }) ' +
     'while `(` identifier(x) `)` ;))'],
    ['do a\n while (b)\n x++',
     'program(doStmnt(do expressionStmnt(identifier(a) ;()) while `(` identifier(b) `)` ;()) ' +
     'expressionStmnt(postfix(identifier(x) ++) ;()))'],
    ["for(;;);",
     "program(forStmnt(for `(` forSpec(nil() ; nil() ; nil()) `)` emptyStmnt(;)))"],
    ["for(x in y);",
     "program(forStmnt(for `(` forInSpec(identifier(x) in identifier(y)) `)` emptyStmnt(;)))"],
    ["for(var x in y);",
     "program(forStmnt(for `(` forVarInSpec(var varDecl(x) in identifier(y)) `)` emptyStmnt(;)))"],
    ["for(var x;;);",
     "program(forStmnt(for `(` forVarSpec(var varDecl(x) ; nil() ; nil()) `)` emptyStmnt(;)))"],
    ["for(var i=0;i<N;i++) {}",
     "program(forStmnt(for `(` forVarSpec(var varDecl(i = number(0)) ; " +
     "binary(identifier(i) < identifier(N)) ; postfix(identifier(i) ++)) `)` blockStmnt({ })))"],
    ["for (var x=3 in y);",
     "program(forStmnt(for `(` forVarInSpec(var varDecl(x = number(3)) in identifier(y)) `)` " +
     "emptyStmnt(;)))"],
    ["for (x.foo in y);",
     "program(forStmnt(for `(` forInSpec(dot(identifier(x) . foo) in identifier(y)) `)` emptyStmnt(;)))"],
    ["return",
     "program(returnStmnt(return nil() ;()))"],
    ["return;",
     "program(returnStmnt(return nil() ;))"],
    ["return null",
     "program(returnStmnt(return null(null) ;()))"],
    ["return null;",
     "program(returnStmnt(return null(null) ;))"],
    ["return\n1+1",
     "program(returnStmnt(return nil() ;()) expressionStmnt(binary(number(1) + number(1)) ;()))"],
    ["return 1\n  +1",
     "program(returnStmnt(return binary(number(1) + number(1)) ;()))"],
    ["continue",
     "program(continueStmnt(continue nil() ;()))"],
    ["continue foo",
     "program(continueStmnt(continue foo ;()))"],
    ["continue foo;",
     "program(continueStmnt(continue foo ;))"],
    ["continue\n  foo;",
     "program(continueStmnt(continue nil() ;()) expressionStmnt(identifier(foo) ;))"],
    ["break",
     "program(breakStmnt(break nil() ;()))"],
    ["break foo",
     "program(breakStmnt(break foo ;()))"],
    ["break foo;",
     "program(breakStmnt(break foo ;))"],
    ["break\n  foo;",
     "program(breakStmnt(break nil() ;()) expressionStmnt(identifier(foo) ;))"],
    ["throw e;",
     "program(throwStmnt(throw identifier(e) ;))"],
    ["throw e",
     "program(throwStmnt(throw identifier(e) ;()))"],
    ["throw new Error;",
     "program(throwStmnt(throw new(new identifier(Error)) ;))"],
    ["with(x);",
     "program(withStmnt(with `(` identifier(x) `)` emptyStmnt(;)))"],
    ["with(a=b) {}",
     "program(withStmnt(with `(` assignment(identifier(a) = identifier(b)) `)` blockStmnt({ })))"],
    ["switch(x) {}",
     "program(switchStmnt(switch `(` identifier(x) `)` { }))"],
    ["switch(x) {case 1:case 2:case 3:default:case 4:}",
     "program(switchStmnt(switch `(` identifier(x) `)` { " +
     "case(case number(1) :) case(case number(2) :) case(case number(3) :) " +
     "default(default :) case(case number(4) :) }))"],
    ["switch(x) {\ncase 1:\n  return\ncase 2:\ncase 3:\n  throw e}",
     "program(switchStmnt(switch `(` identifier(x) `)` { " +
     "case(case number(1) : returnStmnt(return nil() ;())) " +
     "case(case number(2) :) case(case number(3) : " +
     "throwStmnt(throw identifier(e) ;())) }))"],
    ["switch(x) {default:;}",
     "program(switchStmnt(switch `(` identifier(x) `)` { default(default : emptyStmnt(;)) }))"],
    ["try {} catch (e) {} finally {}",
     "program(tryStmnt(try blockStmnt({ }) catch(catch `(` e `)` blockStmnt({ })) " +
     "finally(finally blockStmnt({ }))))"],
    ["try {} finally {}",
     "program(tryStmnt(try blockStmnt({ }) nil() finally(finally blockStmnt({ }))))"],
    ["try {} catch (e) {}",
     "program(tryStmnt(try blockStmnt({ }) catch(catch `(` e `)` blockStmnt({ })) nil()))"],
    ["a:;",
     "program(labelStmnt(a : emptyStmnt(;)))"],
    ["{x:1}",
     "program(blockStmnt({ labelStmnt(x : expressionStmnt(number(1) ;())) }))"],
    ["{x:y:z:1}",
     "program(blockStmnt({ labelStmnt(x : labelStmnt(y : " +
     "labelStmnt(z : expressionStmnt(number(1) ;())))) }))"],
    [";;foo:\nfor(;;);",
     "program(emptyStmnt(;) emptyStmnt(;) labelStmnt(foo : " +
     "forStmnt(for `(` forSpec(nil() ; nil() ; nil()) `)` emptyStmnt(;))))"],
    ["debugger",
     "program(debuggerStmnt(debugger ;()))"],
    ["debugger;",
     "program(debuggerStmnt(debugger ;))"],
    ["function foo() {}",
     "program(functionDecl(function foo `(` `)` { }))"],
    ["function foo() {function bar() {}}",
     "program(functionDecl(function foo `(` `)` { functionDecl(function bar `(` `)` { }) }))"],
    [";;function f() {};;",
     "program(emptyStmnt(;) emptyStmnt(;) functionDecl(function f `(` `)` { }) " +
     "emptyStmnt(;) emptyStmnt(;))"],
    ["function foo(a,b,c) {}",
     "program(functionDecl(function foo `(` a , b , c `)` { }))"],

    // EXPRESSIONS
    ["null + this - 3 + true",
     "program(expressionStmnt(binary(binary(binary(null(null) + this(this)) - " +
     "number(3)) + boolean(true)) ;()))"],
    ["a / /b/mgi / c",
     "program(expressionStmnt(binary(binary(identifier(a) / " +
     "regex(/b/mgi)) / identifier(c)) ;()))"],
    ["'a' + \"\" + \"b\" + '\\''",
     "program(expressionStmnt(binary(binary(binary(string('a') + string(\"\")) + " +
     "string(\"b\")) + string('\\'')) ;()))"],
    ["_ + x0123 + $",
     "program(expressionStmnt(binary(binary(identifier(_) + " +
     "identifier(x0123)) + identifier($)) ;()))"],
    ["if ((x = 1)) return ((1+2))*((1<<2));",
     "program(ifStmnt(if `(` parens(`(` assignment(identifier(x) = number(1)) `)`) " +
     "`)` returnStmnt(return binary(parens(`(` parens(`(` binary(number(1) + " +
     "number(2)) `)`) `)`) * parens(`(` parens(`(` binary(number(1) << number(2)) " +
     "`)`) `)`)) ;)))"],
    ["[];",
     "program(expressionStmnt(array([ ]) ;))"],
    ["[,,,];",
     "program(expressionStmnt(array([ , , , ]) ;))"],
    ["[(1,2),,3];",
     "program(expressionStmnt(array([ parens(`(` comma(number(1) , " +
     "number(2)) `)`) , , number(3) ]) ;))"],
    ["({});",
     "program(expressionStmnt(parens(`(` object({ }) `)`) ;))"],
    ["({1:1});",
     "program(expressionStmnt(parens(`(` object({ prop(numPropName(1) : number(1)) }) `)`) ;))"],
    ["({x:true});",
     "program(expressionStmnt(parens(`(` object({ prop(idPropName(x) : boolean(true)) }) `)`) ;))"],
    ["({'a':b, c:'d', 1:null});",
     "program(expressionStmnt(parens(`(` object({ prop(strPropName('a') : " +
     "identifier(b)) , prop(idPropName(c) : string('d')) , prop(numPropName(1) " +
     ": null(null)) }) `)`) ;))"],
    ["(function () {});",
     "program(expressionStmnt(parens(`(` functionExpr(function nil() `(` `)` { }) `)`) ;))"],
    ["(function foo() {});",
     "program(expressionStmnt(parens(`(` functionExpr(function foo `(` `)` { }) `)`) ;))"],
    ["x = function () {}.y;",
     "program(expressionStmnt(assignment(identifier(x) = dot(functionExpr(" +
     "function nil() `(` `)` { }) . y)) ;))"],
    ["(function (a) {})",
     "program(expressionStmnt(parens(`(` functionExpr(function nil() " +
     "`(` a `)` { }) `)`) ;()))"],
    ["(function (a,b,c) {})",
     "program(expressionStmnt(parens(`(` functionExpr(function nil() `(` " +
     "a , b , c `)` { }) `)`) ;()))"],
    ["foo.bar.baz;",
     "program(expressionStmnt(dot(dot(identifier(foo) . bar) . baz) ;))"],
    ["foo[bar,bar][baz].qux[1+1];",
     "program(expressionStmnt(bracket(dot(bracket(bracket(identifier(foo) " +
     "[ comma(identifier(bar) , identifier(bar)) ]) [ identifier(baz) ]) . qux) " +
     "[ binary(number(1) + number(1)) ]) ;))"],
    ["new new a.b.c[d]",
     "program(expressionStmnt(new(new new(new bracket(dot(dot(identifier(a) " +
     ". b) . c) [ identifier(d) ]))) ;()))"],
    ["new new a.b.c[d]()",
     "program(expressionStmnt(new(new newcall(new " +
     "bracket(dot(dot(identifier(a) . b) . c) [ identifier(d) ]) `(` `)`)) ;()))"],
    ["new new a.b.c[d]()()",
     "program(expressionStmnt(newcall(new newcall(new " +
     "bracket(dot(dot(identifier(a) . b) . c) [ identifier(d) ]) `(` `)`) `(` `)`) ;()))"],
    ["new foo(x).bar(y)",
     "program(expressionStmnt(call(dot(newcall(new identifier(foo) `(` " +
     "identifier(x) `)`) . bar) `(` identifier(y) `)`) ;()))"],
    ["new new foo().bar",
     "program(expressionStmnt(new(new dot(newcall(new identifier(foo) `(` `)`) . bar)) ;()))"],
    ["delete void typeof - + ~ ! -- ++ x;",
     "program(expressionStmnt(unary(delete unary(void unary(typeof unary(- unary(+ " +
     "unary(~ unary(! unary(-- unary(++ identifier(x)))))))))) ;))"],
    ["x++ + ++y",
     "program(expressionStmnt(binary(postfix(identifier(x) ++) + " +
     "unary(++ identifier(y))) ;()))"],
    ["1*2+3*4",
     "program(expressionStmnt(binary(binary(number(1) * number(2)) " +
     "+ binary(number(3) * number(4))) ;()))"],
    ["a*b/c%d+e-f<<g>>h>>>i<j>k<=l>=m instanceof n in o==p!=q===r!==s&t^u|v&&w||x",
     "program(expressionStmnt(binary(binary(binary(binary(binary(binary(binary(" +
     "binary(binary(binary(binary(binary(binary(binary(binary(binary(binary(binary(" +
     "binary(binary(binary(binary(binary(identifier(a) * identifier(b)) / " +
     "identifier(c)) % identifier(d)) + identifier(e)) - identifier(f)) << identifier(g)) " +
     ">> identifier(h)) >>> identifier(i)) < identifier(j)) > identifier(k)) <= " +
     "identifier(l)) >= identifier(m)) instanceof identifier(n)) in identifier(o)) == " +
     "identifier(p)) != identifier(q)) === identifier(r)) !== identifier(s)) & " +
     "identifier(t)) ^ identifier(u)) | identifier(v)) && identifier(w)) || " +
     "identifier(x)) ;()))"],
    ["a||b&&c|d^e&f!==g===h!=i==j in k instanceof l>=m<=n<o<p>>>q>>r<<s-t+u%v/w*x",
     "program(expressionStmnt(binary(identifier(a) || binary(identifier(b) && " +
     "binary(identifier(c) | binary(identifier(d) ^ binary(identifier(e) & " +
     "binary(binary(binary(binary(identifier(f) !== identifier(g)) === identifier(h)) " +
     "!= identifier(i)) == binary(binary(binary(binary(binary(binary(identifier(j) in " +
     "identifier(k)) instanceof identifier(l)) >= identifier(m)) <= identifier(n)) < " +
     "identifier(o)) < binary(binary(binary(identifier(p) >>> identifier(q)) >> " +
     "identifier(r)) << binary(binary(identifier(s) - identifier(t)) + " +
     "binary(binary(binary(identifier(u) % identifier(v)) / identifier(w)) * " +
     "identifier(x))))))))))) ;()))"],
    ["a?b:c",
     "program(expressionStmnt(ternary(identifier(a) ? identifier(b) : " +
     "identifier(c)) ;()))"],
    ["1==2?3=4:5=6",
     "program(expressionStmnt(ternary(binary(number(1) == number(2)) ? " +
     "assignment(number(3) = number(4)) : assignment(number(5) = number(6))) ;()))"],
    ["1=2,3=4",
     "program(expressionStmnt(comma(assignment(number(1) = number(2)) , " +
     "assignment(number(3) = number(4))) ;()))"],
    ["a=b=c=d",
     "program(expressionStmnt(assignment(identifier(a) = assignment(identifier(b) " +
     "= assignment(identifier(c) = identifier(d)))) ;()))"],
    ["x[0]=x[1]=true",
     "program(expressionStmnt(assignment(bracket(identifier(x) [ number(0) ]) = " +
     "assignment(bracket(identifier(x) [ number(1) ]) = boolean(true))) ;()))"],
    ["a*=b/=c%=d+=e-=f<<=g>>=h>>>=i&=j^=k|=l",
     "program(expressionStmnt(assignment(identifier(a) *= assignment(identifier(b) " +
     "/= assignment(identifier(c) %= assignment(identifier(d) += " +
     "assignment(identifier(e) -= assignment(identifier(f) <<= " +
     "assignment(identifier(g) >>= assignment(identifier(h) >>>= " +
     "assignment(identifier(i) &= assignment(identifier(j) ^= " +
     "assignment(identifier(k) |= identifier(l)))))))))))) ;()))"]
  ];
  _.each(trials, function (tr) {
    tester.goodParse(tr[0], tr[1]);
  });
});

// Generating a trial:
//(function (s) { return JSON.stringify([s, parseToTreeString(s)]); })('...')

Tinytest.add("jsparse - bad parses", function (test) {
  var tester = makeTester(test);
  var trials = [
    '{`statement`',
    'if (`expression`)',
    'if `(`else',
    'var`varDecl`;',
    'while (`expression`);',
    'while`(`;',
    'do a `semicolon`while b;',
    'do a\n while `(`b;',
    '1 `semicolon`2',
    'for (`forSpec`);',
    'for (1\n`semicolon`2\n3);',
    'continue `semicolon`1+1;',
    'break `semicolon`1+1;',
    'throw`expression`',
    'throw`expression`;',
    'throw\n`expression``end of line`e',
    'throw `expression`=;',
    'with(`expression`);',
    'switch(`expression`)',
    'switch(x)`{`;',
    'try`block`',
    'try {}`catch`',
    'try {} catch`(`;',
    'try {} catch(e)`block`;',
    '1+1`semicolon`:',
    '{a:`statement`}',
    'function `IDENTIFIER`() {}',
    'foo: `statement`function foo() {}',
    '[`expression`=',
    '[,,`expression`=',
    '({`name:value`true:3})',
    '({1:2,3`:`})',
    '({1:2,`name:value`',
    'x.`IDENTIFIER`true',
    'foo;`semicolon`:;'
  ];
  _.each(trials, function (tr) {
    tester.badParse(tr);
  });
});

Tinytest.add("jsparse - regex division ambiguity", function (test) {
  var tester = makeTester(test);
  tester.goodParse("if (e) /f/g;",
                   "program(ifStmnt(if `(` identifier(e) `)` expressionStmnt(regex(/f/g) ;)))",
                   {4: true});
  tester.goodParse("++/x/.y;",
                   "program(expressionStmnt(unary(++ dot(regex(/x/) . y)) ;))",
                   {1: true});
  tester.goodParse("x++/2/g;",
                   "program(expressionStmnt(binary(binary(postfix(identifier(x) ++) / " +
                   "number(2)) / identifier(g)) ;))");
  tester.goodParse("(1+1)/2/g;",
                   "program(expressionStmnt(binary(binary(parens(`(` binary(number(1) + " +
                   "number(1)) `)`) / " +
                   "number(2)) / identifier(g)) ;))");
  tester.goodParse("/x/",
                   "program(expressionStmnt(regex(/x/) ;()))");
});

Tinytest.add("jsparse - semicolon insertion", function (test) {
  var tester = makeTester(test);
  // Spec section 7.9.2
  tester.badParse("{ 1 `semicolon`2 } 3");
  tester.goodParse("{ 1\n2 } 3", "program(blockStmnt({ expressionStmnt(number(1) " +
                   ";()) expressionStmnt(number(2) ;()) }) expressionStmnt(number(3) ;()))");
  tester.badParse("for (a; b\n`semicolon`)");
  tester.goodParse("return\na + b",
                   "program(returnStmnt(return nil() ;()) " +
                   "expressionStmnt(binary(identifier(a) + identifier(b)) ;()))");
  tester.goodParse("a = b\n++c",
                   "program(expressionStmnt(assignment(identifier(a) = identifier(b)) ;())" +
                   "expressionStmnt(unary(++ identifier(c)) ;()))");
  tester.badParse("if (a > b)\n`statement`else c = d");
  tester.goodParse("a = b + c\n(d + e).print()",
                   "program(expressionStmnt(assignment(identifier(a) = " +
                   "binary(identifier(b) + call(dot(call(identifier(c) `(` " +
                   "binary(identifier(d) + identifier(e)) `)`) . print) `(` `)`))) ;()))");
});

Tinytest.add("jsparse - comments", function (test) {
  var tester = makeTester(test);
  // newline in multi-line comment makes it into a line break for semicolon
  // insertion purposes
  tester.badParse("1/**/`semicolon`2");
  tester.goodParse("1/*\n*/2",
                   "program(expressionStmnt(number(1) ;()) expressionStmnt(number(2) ;()))");
});