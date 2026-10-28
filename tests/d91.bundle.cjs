"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/react/cjs/react.production.min.js
var require_react_production_min = __commonJS({
  "node_modules/react/cjs/react.production.min.js"(exports2) {
    "use strict";
    var l = Symbol.for("react.element");
    var n = Symbol.for("react.portal");
    var p = Symbol.for("react.fragment");
    var q = Symbol.for("react.strict_mode");
    var r = Symbol.for("react.profiler");
    var t = Symbol.for("react.provider");
    var u = Symbol.for("react.context");
    var v = Symbol.for("react.forward_ref");
    var w = Symbol.for("react.suspense");
    var x = Symbol.for("react.memo");
    var y = Symbol.for("react.lazy");
    var z = Symbol.iterator;
    function A(a) {
      if (null === a || "object" !== typeof a) return null;
      a = z && a[z] || a["@@iterator"];
      return "function" === typeof a ? a : null;
    }
    var B = { isMounted: function() {
      return false;
    }, enqueueForceUpdate: function() {
    }, enqueueReplaceState: function() {
    }, enqueueSetState: function() {
    } };
    var C = Object.assign;
    var D = {};
    function E(a, b, e) {
      this.props = a;
      this.context = b;
      this.refs = D;
      this.updater = e || B;
    }
    E.prototype.isReactComponent = {};
    E.prototype.setState = function(a, b) {
      if ("object" !== typeof a && "function" !== typeof a && null != a) throw Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.");
      this.updater.enqueueSetState(this, a, b, "setState");
    };
    E.prototype.forceUpdate = function(a) {
      this.updater.enqueueForceUpdate(this, a, "forceUpdate");
    };
    function F() {
    }
    F.prototype = E.prototype;
    function G(a, b, e) {
      this.props = a;
      this.context = b;
      this.refs = D;
      this.updater = e || B;
    }
    var H = G.prototype = new F();
    H.constructor = G;
    C(H, E.prototype);
    H.isPureReactComponent = true;
    var I = Array.isArray;
    var J = Object.prototype.hasOwnProperty;
    var K = { current: null };
    var L = { key: true, ref: true, __self: true, __source: true };
    function M(a, b, e) {
      var d, c = {}, k = null, h = null;
      if (null != b) for (d in void 0 !== b.ref && (h = b.ref), void 0 !== b.key && (k = "" + b.key), b) J.call(b, d) && !L.hasOwnProperty(d) && (c[d] = b[d]);
      var g = arguments.length - 2;
      if (1 === g) c.children = e;
      else if (1 < g) {
        for (var f = Array(g), m = 0; m < g; m++) f[m] = arguments[m + 2];
        c.children = f;
      }
      if (a && a.defaultProps) for (d in g = a.defaultProps, g) void 0 === c[d] && (c[d] = g[d]);
      return { $$typeof: l, type: a, key: k, ref: h, props: c, _owner: K.current };
    }
    function N(a, b) {
      return { $$typeof: l, type: a.type, key: b, ref: a.ref, props: a.props, _owner: a._owner };
    }
    function O(a) {
      return "object" === typeof a && null !== a && a.$$typeof === l;
    }
    function escape(a) {
      var b = { "=": "=0", ":": "=2" };
      return "$" + a.replace(/[=:]/g, function(a2) {
        return b[a2];
      });
    }
    var P = /\/+/g;
    function Q(a, b) {
      return "object" === typeof a && null !== a && null != a.key ? escape("" + a.key) : b.toString(36);
    }
    function R(a, b, e, d, c) {
      var k = typeof a;
      if ("undefined" === k || "boolean" === k) a = null;
      var h = false;
      if (null === a) h = true;
      else switch (k) {
        case "string":
        case "number":
          h = true;
          break;
        case "object":
          switch (a.$$typeof) {
            case l:
            case n:
              h = true;
          }
      }
      if (h) return h = a, c = c(h), a = "" === d ? "." + Q(h, 0) : d, I(c) ? (e = "", null != a && (e = a.replace(P, "$&/") + "/"), R(c, b, e, "", function(a2) {
        return a2;
      })) : null != c && (O(c) && (c = N(c, e + (!c.key || h && h.key === c.key ? "" : ("" + c.key).replace(P, "$&/") + "/") + a)), b.push(c)), 1;
      h = 0;
      d = "" === d ? "." : d + ":";
      if (I(a)) for (var g = 0; g < a.length; g++) {
        k = a[g];
        var f = d + Q(k, g);
        h += R(k, b, e, f, c);
      }
      else if (f = A(a), "function" === typeof f) for (a = f.call(a), g = 0; !(k = a.next()).done; ) k = k.value, f = d + Q(k, g++), h += R(k, b, e, f, c);
      else if ("object" === k) throw b = String(a), Error("Objects are not valid as a React child (found: " + ("[object Object]" === b ? "object with keys {" + Object.keys(a).join(", ") + "}" : b) + "). If you meant to render a collection of children, use an array instead.");
      return h;
    }
    function S(a, b, e) {
      if (null == a) return a;
      var d = [], c = 0;
      R(a, d, "", "", function(a2) {
        return b.call(e, a2, c++);
      });
      return d;
    }
    function T(a) {
      if (-1 === a._status) {
        var b = a._result;
        b = b();
        b.then(function(b2) {
          if (0 === a._status || -1 === a._status) a._status = 1, a._result = b2;
        }, function(b2) {
          if (0 === a._status || -1 === a._status) a._status = 2, a._result = b2;
        });
        -1 === a._status && (a._status = 0, a._result = b);
      }
      if (1 === a._status) return a._result.default;
      throw a._result;
    }
    var U = { current: null };
    var V = { transition: null };
    var W = { ReactCurrentDispatcher: U, ReactCurrentBatchConfig: V, ReactCurrentOwner: K };
    function X() {
      throw Error("act(...) is not supported in production builds of React.");
    }
    exports2.Children = { map: S, forEach: function(a, b, e) {
      S(a, function() {
        b.apply(this, arguments);
      }, e);
    }, count: function(a) {
      var b = 0;
      S(a, function() {
        b++;
      });
      return b;
    }, toArray: function(a) {
      return S(a, function(a2) {
        return a2;
      }) || [];
    }, only: function(a) {
      if (!O(a)) throw Error("React.Children.only expected to receive a single React element child.");
      return a;
    } };
    exports2.Component = E;
    exports2.Fragment = p;
    exports2.Profiler = r;
    exports2.PureComponent = G;
    exports2.StrictMode = q;
    exports2.Suspense = w;
    exports2.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = W;
    exports2.act = X;
    exports2.cloneElement = function(a, b, e) {
      if (null === a || void 0 === a) throw Error("React.cloneElement(...): The argument must be a React element, but you passed " + a + ".");
      var d = C({}, a.props), c = a.key, k = a.ref, h = a._owner;
      if (null != b) {
        void 0 !== b.ref && (k = b.ref, h = K.current);
        void 0 !== b.key && (c = "" + b.key);
        if (a.type && a.type.defaultProps) var g = a.type.defaultProps;
        for (f in b) J.call(b, f) && !L.hasOwnProperty(f) && (d[f] = void 0 === b[f] && void 0 !== g ? g[f] : b[f]);
      }
      var f = arguments.length - 2;
      if (1 === f) d.children = e;
      else if (1 < f) {
        g = Array(f);
        for (var m = 0; m < f; m++) g[m] = arguments[m + 2];
        d.children = g;
      }
      return { $$typeof: l, type: a.type, key: c, ref: k, props: d, _owner: h };
    };
    exports2.createContext = function(a) {
      a = { $$typeof: u, _currentValue: a, _currentValue2: a, _threadCount: 0, Provider: null, Consumer: null, _defaultValue: null, _globalName: null };
      a.Provider = { $$typeof: t, _context: a };
      return a.Consumer = a;
    };
    exports2.createElement = M;
    exports2.createFactory = function(a) {
      var b = M.bind(null, a);
      b.type = a;
      return b;
    };
    exports2.createRef = function() {
      return { current: null };
    };
    exports2.forwardRef = function(a) {
      return { $$typeof: v, render: a };
    };
    exports2.isValidElement = O;
    exports2.lazy = function(a) {
      return { $$typeof: y, _payload: { _status: -1, _result: a }, _init: T };
    };
    exports2.memo = function(a, b) {
      return { $$typeof: x, type: a, compare: void 0 === b ? null : b };
    };
    exports2.startTransition = function(a) {
      var b = V.transition;
      V.transition = {};
      try {
        a();
      } finally {
        V.transition = b;
      }
    };
    exports2.unstable_act = X;
    exports2.useCallback = function(a, b) {
      return U.current.useCallback(a, b);
    };
    exports2.useContext = function(a) {
      return U.current.useContext(a);
    };
    exports2.useDebugValue = function() {
    };
    exports2.useDeferredValue = function(a) {
      return U.current.useDeferredValue(a);
    };
    exports2.useEffect = function(a, b) {
      return U.current.useEffect(a, b);
    };
    exports2.useId = function() {
      return U.current.useId();
    };
    exports2.useImperativeHandle = function(a, b, e) {
      return U.current.useImperativeHandle(a, b, e);
    };
    exports2.useInsertionEffect = function(a, b) {
      return U.current.useInsertionEffect(a, b);
    };
    exports2.useLayoutEffect = function(a, b) {
      return U.current.useLayoutEffect(a, b);
    };
    exports2.useMemo = function(a, b) {
      return U.current.useMemo(a, b);
    };
    exports2.useReducer = function(a, b, e) {
      return U.current.useReducer(a, b, e);
    };
    exports2.useRef = function(a) {
      return U.current.useRef(a);
    };
    exports2.useState = function(a) {
      return U.current.useState(a);
    };
    exports2.useSyncExternalStore = function(a, b, e) {
      return U.current.useSyncExternalStore(a, b, e);
    };
    exports2.useTransition = function() {
      return U.current.useTransition();
    };
    exports2.version = "18.3.1";
  }
});

// node_modules/react/cjs/react.development.js
var require_react_development = __commonJS({
  "node_modules/react/cjs/react.development.js"(exports2, module2) {
    "use strict";
    if (process.env.NODE_ENV !== "production") {
      (function() {
        "use strict";
        if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ !== "undefined" && typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart === "function") {
          __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart(new Error());
        }
        var ReactVersion = "18.3.1";
        var REACT_ELEMENT_TYPE = Symbol.for("react.element");
        var REACT_PORTAL_TYPE = Symbol.for("react.portal");
        var REACT_FRAGMENT_TYPE = Symbol.for("react.fragment");
        var REACT_STRICT_MODE_TYPE = Symbol.for("react.strict_mode");
        var REACT_PROFILER_TYPE = Symbol.for("react.profiler");
        var REACT_PROVIDER_TYPE = Symbol.for("react.provider");
        var REACT_CONTEXT_TYPE = Symbol.for("react.context");
        var REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref");
        var REACT_SUSPENSE_TYPE = Symbol.for("react.suspense");
        var REACT_SUSPENSE_LIST_TYPE = Symbol.for("react.suspense_list");
        var REACT_MEMO_TYPE = Symbol.for("react.memo");
        var REACT_LAZY_TYPE = Symbol.for("react.lazy");
        var REACT_OFFSCREEN_TYPE = Symbol.for("react.offscreen");
        var MAYBE_ITERATOR_SYMBOL = Symbol.iterator;
        var FAUX_ITERATOR_SYMBOL = "@@iterator";
        function getIteratorFn(maybeIterable) {
          if (maybeIterable === null || typeof maybeIterable !== "object") {
            return null;
          }
          var maybeIterator = MAYBE_ITERATOR_SYMBOL && maybeIterable[MAYBE_ITERATOR_SYMBOL] || maybeIterable[FAUX_ITERATOR_SYMBOL];
          if (typeof maybeIterator === "function") {
            return maybeIterator;
          }
          return null;
        }
        var ReactCurrentDispatcher = {
          /**
           * @internal
           * @type {ReactComponent}
           */
          current: null
        };
        var ReactCurrentBatchConfig = {
          transition: null
        };
        var ReactCurrentActQueue = {
          current: null,
          // Used to reproduce behavior of `batchedUpdates` in legacy mode.
          isBatchingLegacy: false,
          didScheduleLegacyUpdate: false
        };
        var ReactCurrentOwner = {
          /**
           * @internal
           * @type {ReactComponent}
           */
          current: null
        };
        var ReactDebugCurrentFrame = {};
        var currentExtraStackFrame = null;
        function setExtraStackFrame(stack) {
          {
            currentExtraStackFrame = stack;
          }
        }
        {
          ReactDebugCurrentFrame.setExtraStackFrame = function(stack) {
            {
              currentExtraStackFrame = stack;
            }
          };
          ReactDebugCurrentFrame.getCurrentStack = null;
          ReactDebugCurrentFrame.getStackAddendum = function() {
            var stack = "";
            if (currentExtraStackFrame) {
              stack += currentExtraStackFrame;
            }
            var impl = ReactDebugCurrentFrame.getCurrentStack;
            if (impl) {
              stack += impl() || "";
            }
            return stack;
          };
        }
        var enableScopeAPI = false;
        var enableCacheElement = false;
        var enableTransitionTracing = false;
        var enableLegacyHidden = false;
        var enableDebugTracing = false;
        var ReactSharedInternals = {
          ReactCurrentDispatcher,
          ReactCurrentBatchConfig,
          ReactCurrentOwner
        };
        {
          ReactSharedInternals.ReactDebugCurrentFrame = ReactDebugCurrentFrame;
          ReactSharedInternals.ReactCurrentActQueue = ReactCurrentActQueue;
        }
        function warn(format) {
          {
            {
              for (var _len = arguments.length, args = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
                args[_key - 1] = arguments[_key];
              }
              printWarning("warn", format, args);
            }
          }
        }
        function error(format) {
          {
            {
              for (var _len2 = arguments.length, args = new Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) {
                args[_key2 - 1] = arguments[_key2];
              }
              printWarning("error", format, args);
            }
          }
        }
        function printWarning(level, format, args) {
          {
            var ReactDebugCurrentFrame2 = ReactSharedInternals.ReactDebugCurrentFrame;
            var stack = ReactDebugCurrentFrame2.getStackAddendum();
            if (stack !== "") {
              format += "%s";
              args = args.concat([stack]);
            }
            var argsWithFormat = args.map(function(item) {
              return String(item);
            });
            argsWithFormat.unshift("Warning: " + format);
            Function.prototype.apply.call(console[level], console, argsWithFormat);
          }
        }
        var didWarnStateUpdateForUnmountedComponent = {};
        function warnNoop(publicInstance, callerName) {
          {
            var _constructor = publicInstance.constructor;
            var componentName = _constructor && (_constructor.displayName || _constructor.name) || "ReactClass";
            var warningKey = componentName + "." + callerName;
            if (didWarnStateUpdateForUnmountedComponent[warningKey]) {
              return;
            }
            error("Can't call %s on a component that is not yet mounted. This is a no-op, but it might indicate a bug in your application. Instead, assign to `this.state` directly or define a `state = {};` class property with the desired state in the %s component.", callerName, componentName);
            didWarnStateUpdateForUnmountedComponent[warningKey] = true;
          }
        }
        var ReactNoopUpdateQueue = {
          /**
           * Checks whether or not this composite component is mounted.
           * @param {ReactClass} publicInstance The instance we want to test.
           * @return {boolean} True if mounted, false otherwise.
           * @protected
           * @final
           */
          isMounted: function(publicInstance) {
            return false;
          },
          /**
           * Forces an update. This should only be invoked when it is known with
           * certainty that we are **not** in a DOM transaction.
           *
           * You may want to call this when you know that some deeper aspect of the
           * component's state has changed but `setState` was not called.
           *
           * This will not invoke `shouldComponentUpdate`, but it will invoke
           * `componentWillUpdate` and `componentDidUpdate`.
           *
           * @param {ReactClass} publicInstance The instance that should rerender.
           * @param {?function} callback Called after component is updated.
           * @param {?string} callerName name of the calling function in the public API.
           * @internal
           */
          enqueueForceUpdate: function(publicInstance, callback, callerName) {
            warnNoop(publicInstance, "forceUpdate");
          },
          /**
           * Replaces all of the state. Always use this or `setState` to mutate state.
           * You should treat `this.state` as immutable.
           *
           * There is no guarantee that `this.state` will be immediately updated, so
           * accessing `this.state` after calling this method may return the old value.
           *
           * @param {ReactClass} publicInstance The instance that should rerender.
           * @param {object} completeState Next state.
           * @param {?function} callback Called after component is updated.
           * @param {?string} callerName name of the calling function in the public API.
           * @internal
           */
          enqueueReplaceState: function(publicInstance, completeState, callback, callerName) {
            warnNoop(publicInstance, "replaceState");
          },
          /**
           * Sets a subset of the state. This only exists because _pendingState is
           * internal. This provides a merging strategy that is not available to deep
           * properties which is confusing. TODO: Expose pendingState or don't use it
           * during the merge.
           *
           * @param {ReactClass} publicInstance The instance that should rerender.
           * @param {object} partialState Next partial state to be merged with state.
           * @param {?function} callback Called after component is updated.
           * @param {?string} Name of the calling function in the public API.
           * @internal
           */
          enqueueSetState: function(publicInstance, partialState, callback, callerName) {
            warnNoop(publicInstance, "setState");
          }
        };
        var assign = Object.assign;
        var emptyObject = {};
        {
          Object.freeze(emptyObject);
        }
        function Component(props, context, updater) {
          this.props = props;
          this.context = context;
          this.refs = emptyObject;
          this.updater = updater || ReactNoopUpdateQueue;
        }
        Component.prototype.isReactComponent = {};
        Component.prototype.setState = function(partialState, callback) {
          if (typeof partialState !== "object" && typeof partialState !== "function" && partialState != null) {
            throw new Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.");
          }
          this.updater.enqueueSetState(this, partialState, callback, "setState");
        };
        Component.prototype.forceUpdate = function(callback) {
          this.updater.enqueueForceUpdate(this, callback, "forceUpdate");
        };
        {
          var deprecatedAPIs = {
            isMounted: ["isMounted", "Instead, make sure to clean up subscriptions and pending requests in componentWillUnmount to prevent memory leaks."],
            replaceState: ["replaceState", "Refactor your code to use setState instead (see https://github.com/facebook/react/issues/3236)."]
          };
          var defineDeprecationWarning = function(methodName, info) {
            Object.defineProperty(Component.prototype, methodName, {
              get: function() {
                warn("%s(...) is deprecated in plain JavaScript React classes. %s", info[0], info[1]);
                return void 0;
              }
            });
          };
          for (var fnName in deprecatedAPIs) {
            if (deprecatedAPIs.hasOwnProperty(fnName)) {
              defineDeprecationWarning(fnName, deprecatedAPIs[fnName]);
            }
          }
        }
        function ComponentDummy() {
        }
        ComponentDummy.prototype = Component.prototype;
        function PureComponent(props, context, updater) {
          this.props = props;
          this.context = context;
          this.refs = emptyObject;
          this.updater = updater || ReactNoopUpdateQueue;
        }
        var pureComponentPrototype = PureComponent.prototype = new ComponentDummy();
        pureComponentPrototype.constructor = PureComponent;
        assign(pureComponentPrototype, Component.prototype);
        pureComponentPrototype.isPureReactComponent = true;
        function createRef() {
          var refObject = {
            current: null
          };
          {
            Object.seal(refObject);
          }
          return refObject;
        }
        var isArrayImpl = Array.isArray;
        function isArray(a) {
          return isArrayImpl(a);
        }
        function typeName(value) {
          {
            var hasToStringTag = typeof Symbol === "function" && Symbol.toStringTag;
            var type = hasToStringTag && value[Symbol.toStringTag] || value.constructor.name || "Object";
            return type;
          }
        }
        function willCoercionThrow(value) {
          {
            try {
              testStringCoercion(value);
              return false;
            } catch (e) {
              return true;
            }
          }
        }
        function testStringCoercion(value) {
          return "" + value;
        }
        function checkKeyStringCoercion(value) {
          {
            if (willCoercionThrow(value)) {
              error("The provided key is an unsupported type %s. This value must be coerced to a string before before using it here.", typeName(value));
              return testStringCoercion(value);
            }
          }
        }
        function getWrappedName(outerType, innerType, wrapperName) {
          var displayName = outerType.displayName;
          if (displayName) {
            return displayName;
          }
          var functionName = innerType.displayName || innerType.name || "";
          return functionName !== "" ? wrapperName + "(" + functionName + ")" : wrapperName;
        }
        function getContextName(type) {
          return type.displayName || "Context";
        }
        function getComponentNameFromType(type) {
          if (type == null) {
            return null;
          }
          {
            if (typeof type.tag === "number") {
              error("Received an unexpected object in getComponentNameFromType(). This is likely a bug in React. Please file an issue.");
            }
          }
          if (typeof type === "function") {
            return type.displayName || type.name || null;
          }
          if (typeof type === "string") {
            return type;
          }
          switch (type) {
            case REACT_FRAGMENT_TYPE:
              return "Fragment";
            case REACT_PORTAL_TYPE:
              return "Portal";
            case REACT_PROFILER_TYPE:
              return "Profiler";
            case REACT_STRICT_MODE_TYPE:
              return "StrictMode";
            case REACT_SUSPENSE_TYPE:
              return "Suspense";
            case REACT_SUSPENSE_LIST_TYPE:
              return "SuspenseList";
          }
          if (typeof type === "object") {
            switch (type.$$typeof) {
              case REACT_CONTEXT_TYPE:
                var context = type;
                return getContextName(context) + ".Consumer";
              case REACT_PROVIDER_TYPE:
                var provider = type;
                return getContextName(provider._context) + ".Provider";
              case REACT_FORWARD_REF_TYPE:
                return getWrappedName(type, type.render, "ForwardRef");
              case REACT_MEMO_TYPE:
                var outerName = type.displayName || null;
                if (outerName !== null) {
                  return outerName;
                }
                return getComponentNameFromType(type.type) || "Memo";
              case REACT_LAZY_TYPE: {
                var lazyComponent = type;
                var payload = lazyComponent._payload;
                var init = lazyComponent._init;
                try {
                  return getComponentNameFromType(init(payload));
                } catch (x) {
                  return null;
                }
              }
            }
          }
          return null;
        }
        var hasOwnProperty = Object.prototype.hasOwnProperty;
        var RESERVED_PROPS = {
          key: true,
          ref: true,
          __self: true,
          __source: true
        };
        var specialPropKeyWarningShown, specialPropRefWarningShown, didWarnAboutStringRefs;
        {
          didWarnAboutStringRefs = {};
        }
        function hasValidRef(config) {
          {
            if (hasOwnProperty.call(config, "ref")) {
              var getter = Object.getOwnPropertyDescriptor(config, "ref").get;
              if (getter && getter.isReactWarning) {
                return false;
              }
            }
          }
          return config.ref !== void 0;
        }
        function hasValidKey(config) {
          {
            if (hasOwnProperty.call(config, "key")) {
              var getter = Object.getOwnPropertyDescriptor(config, "key").get;
              if (getter && getter.isReactWarning) {
                return false;
              }
            }
          }
          return config.key !== void 0;
        }
        function defineKeyPropWarningGetter(props, displayName) {
          var warnAboutAccessingKey = function() {
            {
              if (!specialPropKeyWarningShown) {
                specialPropKeyWarningShown = true;
                error("%s: `key` is not a prop. Trying to access it will result in `undefined` being returned. If you need to access the same value within the child component, you should pass it as a different prop. (https://reactjs.org/link/special-props)", displayName);
              }
            }
          };
          warnAboutAccessingKey.isReactWarning = true;
          Object.defineProperty(props, "key", {
            get: warnAboutAccessingKey,
            configurable: true
          });
        }
        function defineRefPropWarningGetter(props, displayName) {
          var warnAboutAccessingRef = function() {
            {
              if (!specialPropRefWarningShown) {
                specialPropRefWarningShown = true;
                error("%s: `ref` is not a prop. Trying to access it will result in `undefined` being returned. If you need to access the same value within the child component, you should pass it as a different prop. (https://reactjs.org/link/special-props)", displayName);
              }
            }
          };
          warnAboutAccessingRef.isReactWarning = true;
          Object.defineProperty(props, "ref", {
            get: warnAboutAccessingRef,
            configurable: true
          });
        }
        function warnIfStringRefCannotBeAutoConverted(config) {
          {
            if (typeof config.ref === "string" && ReactCurrentOwner.current && config.__self && ReactCurrentOwner.current.stateNode !== config.__self) {
              var componentName = getComponentNameFromType(ReactCurrentOwner.current.type);
              if (!didWarnAboutStringRefs[componentName]) {
                error('Component "%s" contains the string ref "%s". Support for string refs will be removed in a future major release. This case cannot be automatically converted to an arrow function. We ask you to manually fix this case by using useRef() or createRef() instead. Learn more about using refs safely here: https://reactjs.org/link/strict-mode-string-ref', componentName, config.ref);
                didWarnAboutStringRefs[componentName] = true;
              }
            }
          }
        }
        var ReactElement = function(type, key, ref, self, source, owner, props) {
          var element = {
            // This tag allows us to uniquely identify this as a React Element
            $$typeof: REACT_ELEMENT_TYPE,
            // Built-in properties that belong on the element
            type,
            key,
            ref,
            props,
            // Record the component responsible for creating this element.
            _owner: owner
          };
          {
            element._store = {};
            Object.defineProperty(element._store, "validated", {
              configurable: false,
              enumerable: false,
              writable: true,
              value: false
            });
            Object.defineProperty(element, "_self", {
              configurable: false,
              enumerable: false,
              writable: false,
              value: self
            });
            Object.defineProperty(element, "_source", {
              configurable: false,
              enumerable: false,
              writable: false,
              value: source
            });
            if (Object.freeze) {
              Object.freeze(element.props);
              Object.freeze(element);
            }
          }
          return element;
        };
        function createElement(type, config, children) {
          var propName;
          var props = {};
          var key = null;
          var ref = null;
          var self = null;
          var source = null;
          if (config != null) {
            if (hasValidRef(config)) {
              ref = config.ref;
              {
                warnIfStringRefCannotBeAutoConverted(config);
              }
            }
            if (hasValidKey(config)) {
              {
                checkKeyStringCoercion(config.key);
              }
              key = "" + config.key;
            }
            self = config.__self === void 0 ? null : config.__self;
            source = config.__source === void 0 ? null : config.__source;
            for (propName in config) {
              if (hasOwnProperty.call(config, propName) && !RESERVED_PROPS.hasOwnProperty(propName)) {
                props[propName] = config[propName];
              }
            }
          }
          var childrenLength = arguments.length - 2;
          if (childrenLength === 1) {
            props.children = children;
          } else if (childrenLength > 1) {
            var childArray = Array(childrenLength);
            for (var i = 0; i < childrenLength; i++) {
              childArray[i] = arguments[i + 2];
            }
            {
              if (Object.freeze) {
                Object.freeze(childArray);
              }
            }
            props.children = childArray;
          }
          if (type && type.defaultProps) {
            var defaultProps = type.defaultProps;
            for (propName in defaultProps) {
              if (props[propName] === void 0) {
                props[propName] = defaultProps[propName];
              }
            }
          }
          {
            if (key || ref) {
              var displayName = typeof type === "function" ? type.displayName || type.name || "Unknown" : type;
              if (key) {
                defineKeyPropWarningGetter(props, displayName);
              }
              if (ref) {
                defineRefPropWarningGetter(props, displayName);
              }
            }
          }
          return ReactElement(type, key, ref, self, source, ReactCurrentOwner.current, props);
        }
        function cloneAndReplaceKey(oldElement, newKey) {
          var newElement = ReactElement(oldElement.type, newKey, oldElement.ref, oldElement._self, oldElement._source, oldElement._owner, oldElement.props);
          return newElement;
        }
        function cloneElement(element, config, children) {
          if (element === null || element === void 0) {
            throw new Error("React.cloneElement(...): The argument must be a React element, but you passed " + element + ".");
          }
          var propName;
          var props = assign({}, element.props);
          var key = element.key;
          var ref = element.ref;
          var self = element._self;
          var source = element._source;
          var owner = element._owner;
          if (config != null) {
            if (hasValidRef(config)) {
              ref = config.ref;
              owner = ReactCurrentOwner.current;
            }
            if (hasValidKey(config)) {
              {
                checkKeyStringCoercion(config.key);
              }
              key = "" + config.key;
            }
            var defaultProps;
            if (element.type && element.type.defaultProps) {
              defaultProps = element.type.defaultProps;
            }
            for (propName in config) {
              if (hasOwnProperty.call(config, propName) && !RESERVED_PROPS.hasOwnProperty(propName)) {
                if (config[propName] === void 0 && defaultProps !== void 0) {
                  props[propName] = defaultProps[propName];
                } else {
                  props[propName] = config[propName];
                }
              }
            }
          }
          var childrenLength = arguments.length - 2;
          if (childrenLength === 1) {
            props.children = children;
          } else if (childrenLength > 1) {
            var childArray = Array(childrenLength);
            for (var i = 0; i < childrenLength; i++) {
              childArray[i] = arguments[i + 2];
            }
            props.children = childArray;
          }
          return ReactElement(element.type, key, ref, self, source, owner, props);
        }
        function isValidElement(object) {
          return typeof object === "object" && object !== null && object.$$typeof === REACT_ELEMENT_TYPE;
        }
        var SEPARATOR = ".";
        var SUBSEPARATOR = ":";
        function escape(key) {
          var escapeRegex = /[=:]/g;
          var escaperLookup = {
            "=": "=0",
            ":": "=2"
          };
          var escapedString = key.replace(escapeRegex, function(match) {
            return escaperLookup[match];
          });
          return "$" + escapedString;
        }
        var didWarnAboutMaps = false;
        var userProvidedKeyEscapeRegex = /\/+/g;
        function escapeUserProvidedKey(text) {
          return text.replace(userProvidedKeyEscapeRegex, "$&/");
        }
        function getElementKey(element, index) {
          if (typeof element === "object" && element !== null && element.key != null) {
            {
              checkKeyStringCoercion(element.key);
            }
            return escape("" + element.key);
          }
          return index.toString(36);
        }
        function mapIntoArray(children, array, escapedPrefix, nameSoFar, callback) {
          var type = typeof children;
          if (type === "undefined" || type === "boolean") {
            children = null;
          }
          var invokeCallback = false;
          if (children === null) {
            invokeCallback = true;
          } else {
            switch (type) {
              case "string":
              case "number":
                invokeCallback = true;
                break;
              case "object":
                switch (children.$$typeof) {
                  case REACT_ELEMENT_TYPE:
                  case REACT_PORTAL_TYPE:
                    invokeCallback = true;
                }
            }
          }
          if (invokeCallback) {
            var _child = children;
            var mappedChild = callback(_child);
            var childKey = nameSoFar === "" ? SEPARATOR + getElementKey(_child, 0) : nameSoFar;
            if (isArray(mappedChild)) {
              var escapedChildKey = "";
              if (childKey != null) {
                escapedChildKey = escapeUserProvidedKey(childKey) + "/";
              }
              mapIntoArray(mappedChild, array, escapedChildKey, "", function(c) {
                return c;
              });
            } else if (mappedChild != null) {
              if (isValidElement(mappedChild)) {
                {
                  if (mappedChild.key && (!_child || _child.key !== mappedChild.key)) {
                    checkKeyStringCoercion(mappedChild.key);
                  }
                }
                mappedChild = cloneAndReplaceKey(
                  mappedChild,
                  // Keep both the (mapped) and old keys if they differ, just as
                  // traverseAllChildren used to do for objects as children
                  escapedPrefix + // $FlowFixMe Flow incorrectly thinks React.Portal doesn't have a key
                  (mappedChild.key && (!_child || _child.key !== mappedChild.key) ? (
                    // $FlowFixMe Flow incorrectly thinks existing element's key can be a number
                    // eslint-disable-next-line react-internal/safe-string-coercion
                    escapeUserProvidedKey("" + mappedChild.key) + "/"
                  ) : "") + childKey
                );
              }
              array.push(mappedChild);
            }
            return 1;
          }
          var child;
          var nextName;
          var subtreeCount = 0;
          var nextNamePrefix = nameSoFar === "" ? SEPARATOR : nameSoFar + SUBSEPARATOR;
          if (isArray(children)) {
            for (var i = 0; i < children.length; i++) {
              child = children[i];
              nextName = nextNamePrefix + getElementKey(child, i);
              subtreeCount += mapIntoArray(child, array, escapedPrefix, nextName, callback);
            }
          } else {
            var iteratorFn = getIteratorFn(children);
            if (typeof iteratorFn === "function") {
              var iterableChildren = children;
              {
                if (iteratorFn === iterableChildren.entries) {
                  if (!didWarnAboutMaps) {
                    warn("Using Maps as children is not supported. Use an array of keyed ReactElements instead.");
                  }
                  didWarnAboutMaps = true;
                }
              }
              var iterator = iteratorFn.call(iterableChildren);
              var step;
              var ii = 0;
              while (!(step = iterator.next()).done) {
                child = step.value;
                nextName = nextNamePrefix + getElementKey(child, ii++);
                subtreeCount += mapIntoArray(child, array, escapedPrefix, nextName, callback);
              }
            } else if (type === "object") {
              var childrenString = String(children);
              throw new Error("Objects are not valid as a React child (found: " + (childrenString === "[object Object]" ? "object with keys {" + Object.keys(children).join(", ") + "}" : childrenString) + "). If you meant to render a collection of children, use an array instead.");
            }
          }
          return subtreeCount;
        }
        function mapChildren(children, func, context) {
          if (children == null) {
            return children;
          }
          var result = [];
          var count = 0;
          mapIntoArray(children, result, "", "", function(child) {
            return func.call(context, child, count++);
          });
          return result;
        }
        function countChildren(children) {
          var n = 0;
          mapChildren(children, function() {
            n++;
          });
          return n;
        }
        function forEachChildren(children, forEachFunc, forEachContext) {
          mapChildren(children, function() {
            forEachFunc.apply(this, arguments);
          }, forEachContext);
        }
        function toArray(children) {
          return mapChildren(children, function(child) {
            return child;
          }) || [];
        }
        function onlyChild(children) {
          if (!isValidElement(children)) {
            throw new Error("React.Children.only expected to receive a single React element child.");
          }
          return children;
        }
        function createContext(defaultValue) {
          var context = {
            $$typeof: REACT_CONTEXT_TYPE,
            // As a workaround to support multiple concurrent renderers, we categorize
            // some renderers as primary and others as secondary. We only expect
            // there to be two concurrent renderers at most: React Native (primary) and
            // Fabric (secondary); React DOM (primary) and React ART (secondary).
            // Secondary renderers store their context values on separate fields.
            _currentValue: defaultValue,
            _currentValue2: defaultValue,
            // Used to track how many concurrent renderers this context currently
            // supports within in a single renderer. Such as parallel server rendering.
            _threadCount: 0,
            // These are circular
            Provider: null,
            Consumer: null,
            // Add these to use same hidden class in VM as ServerContext
            _defaultValue: null,
            _globalName: null
          };
          context.Provider = {
            $$typeof: REACT_PROVIDER_TYPE,
            _context: context
          };
          var hasWarnedAboutUsingNestedContextConsumers = false;
          var hasWarnedAboutUsingConsumerProvider = false;
          var hasWarnedAboutDisplayNameOnConsumer = false;
          {
            var Consumer = {
              $$typeof: REACT_CONTEXT_TYPE,
              _context: context
            };
            Object.defineProperties(Consumer, {
              Provider: {
                get: function() {
                  if (!hasWarnedAboutUsingConsumerProvider) {
                    hasWarnedAboutUsingConsumerProvider = true;
                    error("Rendering <Context.Consumer.Provider> is not supported and will be removed in a future major release. Did you mean to render <Context.Provider> instead?");
                  }
                  return context.Provider;
                },
                set: function(_Provider) {
                  context.Provider = _Provider;
                }
              },
              _currentValue: {
                get: function() {
                  return context._currentValue;
                },
                set: function(_currentValue) {
                  context._currentValue = _currentValue;
                }
              },
              _currentValue2: {
                get: function() {
                  return context._currentValue2;
                },
                set: function(_currentValue2) {
                  context._currentValue2 = _currentValue2;
                }
              },
              _threadCount: {
                get: function() {
                  return context._threadCount;
                },
                set: function(_threadCount) {
                  context._threadCount = _threadCount;
                }
              },
              Consumer: {
                get: function() {
                  if (!hasWarnedAboutUsingNestedContextConsumers) {
                    hasWarnedAboutUsingNestedContextConsumers = true;
                    error("Rendering <Context.Consumer.Consumer> is not supported and will be removed in a future major release. Did you mean to render <Context.Consumer> instead?");
                  }
                  return context.Consumer;
                }
              },
              displayName: {
                get: function() {
                  return context.displayName;
                },
                set: function(displayName) {
                  if (!hasWarnedAboutDisplayNameOnConsumer) {
                    warn("Setting `displayName` on Context.Consumer has no effect. You should set it directly on the context with Context.displayName = '%s'.", displayName);
                    hasWarnedAboutDisplayNameOnConsumer = true;
                  }
                }
              }
            });
            context.Consumer = Consumer;
          }
          {
            context._currentRenderer = null;
            context._currentRenderer2 = null;
          }
          return context;
        }
        var Uninitialized = -1;
        var Pending = 0;
        var Resolved = 1;
        var Rejected = 2;
        function lazyInitializer(payload) {
          if (payload._status === Uninitialized) {
            var ctor = payload._result;
            var thenable = ctor();
            thenable.then(function(moduleObject2) {
              if (payload._status === Pending || payload._status === Uninitialized) {
                var resolved = payload;
                resolved._status = Resolved;
                resolved._result = moduleObject2;
              }
            }, function(error2) {
              if (payload._status === Pending || payload._status === Uninitialized) {
                var rejected = payload;
                rejected._status = Rejected;
                rejected._result = error2;
              }
            });
            if (payload._status === Uninitialized) {
              var pending = payload;
              pending._status = Pending;
              pending._result = thenable;
            }
          }
          if (payload._status === Resolved) {
            var moduleObject = payload._result;
            {
              if (moduleObject === void 0) {
                error("lazy: Expected the result of a dynamic import() call. Instead received: %s\n\nYour code should look like: \n  const MyComponent = lazy(() => import('./MyComponent'))\n\nDid you accidentally put curly braces around the import?", moduleObject);
              }
            }
            {
              if (!("default" in moduleObject)) {
                error("lazy: Expected the result of a dynamic import() call. Instead received: %s\n\nYour code should look like: \n  const MyComponent = lazy(() => import('./MyComponent'))", moduleObject);
              }
            }
            return moduleObject.default;
          } else {
            throw payload._result;
          }
        }
        function lazy(ctor) {
          var payload = {
            // We use these fields to store the result.
            _status: Uninitialized,
            _result: ctor
          };
          var lazyType = {
            $$typeof: REACT_LAZY_TYPE,
            _payload: payload,
            _init: lazyInitializer
          };
          {
            var defaultProps;
            var propTypes;
            Object.defineProperties(lazyType, {
              defaultProps: {
                configurable: true,
                get: function() {
                  return defaultProps;
                },
                set: function(newDefaultProps) {
                  error("React.lazy(...): It is not supported to assign `defaultProps` to a lazy component import. Either specify them where the component is defined, or create a wrapping component around it.");
                  defaultProps = newDefaultProps;
                  Object.defineProperty(lazyType, "defaultProps", {
                    enumerable: true
                  });
                }
              },
              propTypes: {
                configurable: true,
                get: function() {
                  return propTypes;
                },
                set: function(newPropTypes) {
                  error("React.lazy(...): It is not supported to assign `propTypes` to a lazy component import. Either specify them where the component is defined, or create a wrapping component around it.");
                  propTypes = newPropTypes;
                  Object.defineProperty(lazyType, "propTypes", {
                    enumerable: true
                  });
                }
              }
            });
          }
          return lazyType;
        }
        function forwardRef(render) {
          {
            if (render != null && render.$$typeof === REACT_MEMO_TYPE) {
              error("forwardRef requires a render function but received a `memo` component. Instead of forwardRef(memo(...)), use memo(forwardRef(...)).");
            } else if (typeof render !== "function") {
              error("forwardRef requires a render function but was given %s.", render === null ? "null" : typeof render);
            } else {
              if (render.length !== 0 && render.length !== 2) {
                error("forwardRef render functions accept exactly two parameters: props and ref. %s", render.length === 1 ? "Did you forget to use the ref parameter?" : "Any additional parameter will be undefined.");
              }
            }
            if (render != null) {
              if (render.defaultProps != null || render.propTypes != null) {
                error("forwardRef render functions do not support propTypes or defaultProps. Did you accidentally pass a React component?");
              }
            }
          }
          var elementType = {
            $$typeof: REACT_FORWARD_REF_TYPE,
            render
          };
          {
            var ownName;
            Object.defineProperty(elementType, "displayName", {
              enumerable: false,
              configurable: true,
              get: function() {
                return ownName;
              },
              set: function(name) {
                ownName = name;
                if (!render.name && !render.displayName) {
                  render.displayName = name;
                }
              }
            });
          }
          return elementType;
        }
        var REACT_MODULE_REFERENCE;
        {
          REACT_MODULE_REFERENCE = Symbol.for("react.module.reference");
        }
        function isValidElementType(type) {
          if (typeof type === "string" || typeof type === "function") {
            return true;
          }
          if (type === REACT_FRAGMENT_TYPE || type === REACT_PROFILER_TYPE || enableDebugTracing || type === REACT_STRICT_MODE_TYPE || type === REACT_SUSPENSE_TYPE || type === REACT_SUSPENSE_LIST_TYPE || enableLegacyHidden || type === REACT_OFFSCREEN_TYPE || enableScopeAPI || enableCacheElement || enableTransitionTracing) {
            return true;
          }
          if (typeof type === "object" && type !== null) {
            if (type.$$typeof === REACT_LAZY_TYPE || type.$$typeof === REACT_MEMO_TYPE || type.$$typeof === REACT_PROVIDER_TYPE || type.$$typeof === REACT_CONTEXT_TYPE || type.$$typeof === REACT_FORWARD_REF_TYPE || // This needs to include all possible module reference object
            // types supported by any Flight configuration anywhere since
            // we don't know which Flight build this will end up being used
            // with.
            type.$$typeof === REACT_MODULE_REFERENCE || type.getModuleId !== void 0) {
              return true;
            }
          }
          return false;
        }
        function memo(type, compare) {
          {
            if (!isValidElementType(type)) {
              error("memo: The first argument must be a component. Instead received: %s", type === null ? "null" : typeof type);
            }
          }
          var elementType = {
            $$typeof: REACT_MEMO_TYPE,
            type,
            compare: compare === void 0 ? null : compare
          };
          {
            var ownName;
            Object.defineProperty(elementType, "displayName", {
              enumerable: false,
              configurable: true,
              get: function() {
                return ownName;
              },
              set: function(name) {
                ownName = name;
                if (!type.name && !type.displayName) {
                  type.displayName = name;
                }
              }
            });
          }
          return elementType;
        }
        function resolveDispatcher() {
          var dispatcher = ReactCurrentDispatcher.current;
          {
            if (dispatcher === null) {
              error("Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for one of the following reasons:\n1. You might have mismatching versions of React and the renderer (such as React DOM)\n2. You might be breaking the Rules of Hooks\n3. You might have more than one copy of React in the same app\nSee https://reactjs.org/link/invalid-hook-call for tips about how to debug and fix this problem.");
            }
          }
          return dispatcher;
        }
        function useContext(Context) {
          var dispatcher = resolveDispatcher();
          {
            if (Context._context !== void 0) {
              var realContext = Context._context;
              if (realContext.Consumer === Context) {
                error("Calling useContext(Context.Consumer) is not supported, may cause bugs, and will be removed in a future major release. Did you mean to call useContext(Context) instead?");
              } else if (realContext.Provider === Context) {
                error("Calling useContext(Context.Provider) is not supported. Did you mean to call useContext(Context) instead?");
              }
            }
          }
          return dispatcher.useContext(Context);
        }
        function useState(initialState) {
          var dispatcher = resolveDispatcher();
          return dispatcher.useState(initialState);
        }
        function useReducer(reducer, initialArg, init) {
          var dispatcher = resolveDispatcher();
          return dispatcher.useReducer(reducer, initialArg, init);
        }
        function useRef(initialValue) {
          var dispatcher = resolveDispatcher();
          return dispatcher.useRef(initialValue);
        }
        function useEffect(create, deps) {
          var dispatcher = resolveDispatcher();
          return dispatcher.useEffect(create, deps);
        }
        function useInsertionEffect(create, deps) {
          var dispatcher = resolveDispatcher();
          return dispatcher.useInsertionEffect(create, deps);
        }
        function useLayoutEffect(create, deps) {
          var dispatcher = resolveDispatcher();
          return dispatcher.useLayoutEffect(create, deps);
        }
        function useCallback(callback, deps) {
          var dispatcher = resolveDispatcher();
          return dispatcher.useCallback(callback, deps);
        }
        function useMemo(create, deps) {
          var dispatcher = resolveDispatcher();
          return dispatcher.useMemo(create, deps);
        }
        function useImperativeHandle(ref, create, deps) {
          var dispatcher = resolveDispatcher();
          return dispatcher.useImperativeHandle(ref, create, deps);
        }
        function useDebugValue(value, formatterFn) {
          {
            var dispatcher = resolveDispatcher();
            return dispatcher.useDebugValue(value, formatterFn);
          }
        }
        function useTransition() {
          var dispatcher = resolveDispatcher();
          return dispatcher.useTransition();
        }
        function useDeferredValue(value) {
          var dispatcher = resolveDispatcher();
          return dispatcher.useDeferredValue(value);
        }
        function useId() {
          var dispatcher = resolveDispatcher();
          return dispatcher.useId();
        }
        function useSyncExternalStore2(subscribe, getSnapshot, getServerSnapshot) {
          var dispatcher = resolveDispatcher();
          return dispatcher.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
        }
        var disabledDepth = 0;
        var prevLog;
        var prevInfo;
        var prevWarn;
        var prevError;
        var prevGroup;
        var prevGroupCollapsed;
        var prevGroupEnd;
        function disabledLog() {
        }
        disabledLog.__reactDisabledLog = true;
        function disableLogs() {
          {
            if (disabledDepth === 0) {
              prevLog = console.log;
              prevInfo = console.info;
              prevWarn = console.warn;
              prevError = console.error;
              prevGroup = console.group;
              prevGroupCollapsed = console.groupCollapsed;
              prevGroupEnd = console.groupEnd;
              var props = {
                configurable: true,
                enumerable: true,
                value: disabledLog,
                writable: true
              };
              Object.defineProperties(console, {
                info: props,
                log: props,
                warn: props,
                error: props,
                group: props,
                groupCollapsed: props,
                groupEnd: props
              });
            }
            disabledDepth++;
          }
        }
        function reenableLogs() {
          {
            disabledDepth--;
            if (disabledDepth === 0) {
              var props = {
                configurable: true,
                enumerable: true,
                writable: true
              };
              Object.defineProperties(console, {
                log: assign({}, props, {
                  value: prevLog
                }),
                info: assign({}, props, {
                  value: prevInfo
                }),
                warn: assign({}, props, {
                  value: prevWarn
                }),
                error: assign({}, props, {
                  value: prevError
                }),
                group: assign({}, props, {
                  value: prevGroup
                }),
                groupCollapsed: assign({}, props, {
                  value: prevGroupCollapsed
                }),
                groupEnd: assign({}, props, {
                  value: prevGroupEnd
                })
              });
            }
            if (disabledDepth < 0) {
              error("disabledDepth fell below zero. This is a bug in React. Please file an issue.");
            }
          }
        }
        var ReactCurrentDispatcher$1 = ReactSharedInternals.ReactCurrentDispatcher;
        var prefix;
        function describeBuiltInComponentFrame(name, source, ownerFn) {
          {
            if (prefix === void 0) {
              try {
                throw Error();
              } catch (x) {
                var match = x.stack.trim().match(/\n( *(at )?)/);
                prefix = match && match[1] || "";
              }
            }
            return "\n" + prefix + name;
          }
        }
        var reentry = false;
        var componentFrameCache;
        {
          var PossiblyWeakMap = typeof WeakMap === "function" ? WeakMap : Map;
          componentFrameCache = new PossiblyWeakMap();
        }
        function describeNativeComponentFrame(fn, construct) {
          if (!fn || reentry) {
            return "";
          }
          {
            var frame = componentFrameCache.get(fn);
            if (frame !== void 0) {
              return frame;
            }
          }
          var control;
          reentry = true;
          var previousPrepareStackTrace = Error.prepareStackTrace;
          Error.prepareStackTrace = void 0;
          var previousDispatcher;
          {
            previousDispatcher = ReactCurrentDispatcher$1.current;
            ReactCurrentDispatcher$1.current = null;
            disableLogs();
          }
          try {
            if (construct) {
              var Fake = function() {
                throw Error();
              };
              Object.defineProperty(Fake.prototype, "props", {
                set: function() {
                  throw Error();
                }
              });
              if (typeof Reflect === "object" && Reflect.construct) {
                try {
                  Reflect.construct(Fake, []);
                } catch (x) {
                  control = x;
                }
                Reflect.construct(fn, [], Fake);
              } else {
                try {
                  Fake.call();
                } catch (x) {
                  control = x;
                }
                fn.call(Fake.prototype);
              }
            } else {
              try {
                throw Error();
              } catch (x) {
                control = x;
              }
              fn();
            }
          } catch (sample) {
            if (sample && control && typeof sample.stack === "string") {
              var sampleLines = sample.stack.split("\n");
              var controlLines = control.stack.split("\n");
              var s = sampleLines.length - 1;
              var c = controlLines.length - 1;
              while (s >= 1 && c >= 0 && sampleLines[s] !== controlLines[c]) {
                c--;
              }
              for (; s >= 1 && c >= 0; s--, c--) {
                if (sampleLines[s] !== controlLines[c]) {
                  if (s !== 1 || c !== 1) {
                    do {
                      s--;
                      c--;
                      if (c < 0 || sampleLines[s] !== controlLines[c]) {
                        var _frame = "\n" + sampleLines[s].replace(" at new ", " at ");
                        if (fn.displayName && _frame.includes("<anonymous>")) {
                          _frame = _frame.replace("<anonymous>", fn.displayName);
                        }
                        {
                          if (typeof fn === "function") {
                            componentFrameCache.set(fn, _frame);
                          }
                        }
                        return _frame;
                      }
                    } while (s >= 1 && c >= 0);
                  }
                  break;
                }
              }
            }
          } finally {
            reentry = false;
            {
              ReactCurrentDispatcher$1.current = previousDispatcher;
              reenableLogs();
            }
            Error.prepareStackTrace = previousPrepareStackTrace;
          }
          var name = fn ? fn.displayName || fn.name : "";
          var syntheticFrame = name ? describeBuiltInComponentFrame(name) : "";
          {
            if (typeof fn === "function") {
              componentFrameCache.set(fn, syntheticFrame);
            }
          }
          return syntheticFrame;
        }
        function describeFunctionComponentFrame(fn, source, ownerFn) {
          {
            return describeNativeComponentFrame(fn, false);
          }
        }
        function shouldConstruct(Component2) {
          var prototype = Component2.prototype;
          return !!(prototype && prototype.isReactComponent);
        }
        function describeUnknownElementTypeFrameInDEV(type, source, ownerFn) {
          if (type == null) {
            return "";
          }
          if (typeof type === "function") {
            {
              return describeNativeComponentFrame(type, shouldConstruct(type));
            }
          }
          if (typeof type === "string") {
            return describeBuiltInComponentFrame(type);
          }
          switch (type) {
            case REACT_SUSPENSE_TYPE:
              return describeBuiltInComponentFrame("Suspense");
            case REACT_SUSPENSE_LIST_TYPE:
              return describeBuiltInComponentFrame("SuspenseList");
          }
          if (typeof type === "object") {
            switch (type.$$typeof) {
              case REACT_FORWARD_REF_TYPE:
                return describeFunctionComponentFrame(type.render);
              case REACT_MEMO_TYPE:
                return describeUnknownElementTypeFrameInDEV(type.type, source, ownerFn);
              case REACT_LAZY_TYPE: {
                var lazyComponent = type;
                var payload = lazyComponent._payload;
                var init = lazyComponent._init;
                try {
                  return describeUnknownElementTypeFrameInDEV(init(payload), source, ownerFn);
                } catch (x) {
                }
              }
            }
          }
          return "";
        }
        var loggedTypeFailures = {};
        var ReactDebugCurrentFrame$1 = ReactSharedInternals.ReactDebugCurrentFrame;
        function setCurrentlyValidatingElement(element) {
          {
            if (element) {
              var owner = element._owner;
              var stack = describeUnknownElementTypeFrameInDEV(element.type, element._source, owner ? owner.type : null);
              ReactDebugCurrentFrame$1.setExtraStackFrame(stack);
            } else {
              ReactDebugCurrentFrame$1.setExtraStackFrame(null);
            }
          }
        }
        function checkPropTypes(typeSpecs, values, location, componentName, element) {
          {
            var has = Function.call.bind(hasOwnProperty);
            for (var typeSpecName in typeSpecs) {
              if (has(typeSpecs, typeSpecName)) {
                var error$1 = void 0;
                try {
                  if (typeof typeSpecs[typeSpecName] !== "function") {
                    var err = Error((componentName || "React class") + ": " + location + " type `" + typeSpecName + "` is invalid; it must be a function, usually from the `prop-types` package, but received `" + typeof typeSpecs[typeSpecName] + "`.This often happens because of typos such as `PropTypes.function` instead of `PropTypes.func`.");
                    err.name = "Invariant Violation";
                    throw err;
                  }
                  error$1 = typeSpecs[typeSpecName](values, typeSpecName, componentName, location, null, "SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED");
                } catch (ex) {
                  error$1 = ex;
                }
                if (error$1 && !(error$1 instanceof Error)) {
                  setCurrentlyValidatingElement(element);
                  error("%s: type specification of %s `%s` is invalid; the type checker function must return `null` or an `Error` but returned a %s. You may have forgotten to pass an argument to the type checker creator (arrayOf, instanceOf, objectOf, oneOf, oneOfType, and shape all require an argument).", componentName || "React class", location, typeSpecName, typeof error$1);
                  setCurrentlyValidatingElement(null);
                }
                if (error$1 instanceof Error && !(error$1.message in loggedTypeFailures)) {
                  loggedTypeFailures[error$1.message] = true;
                  setCurrentlyValidatingElement(element);
                  error("Failed %s type: %s", location, error$1.message);
                  setCurrentlyValidatingElement(null);
                }
              }
            }
          }
        }
        function setCurrentlyValidatingElement$1(element) {
          {
            if (element) {
              var owner = element._owner;
              var stack = describeUnknownElementTypeFrameInDEV(element.type, element._source, owner ? owner.type : null);
              setExtraStackFrame(stack);
            } else {
              setExtraStackFrame(null);
            }
          }
        }
        var propTypesMisspellWarningShown;
        {
          propTypesMisspellWarningShown = false;
        }
        function getDeclarationErrorAddendum() {
          if (ReactCurrentOwner.current) {
            var name = getComponentNameFromType(ReactCurrentOwner.current.type);
            if (name) {
              return "\n\nCheck the render method of `" + name + "`.";
            }
          }
          return "";
        }
        function getSourceInfoErrorAddendum(source) {
          if (source !== void 0) {
            var fileName = source.fileName.replace(/^.*[\\\/]/, "");
            var lineNumber = source.lineNumber;
            return "\n\nCheck your code at " + fileName + ":" + lineNumber + ".";
          }
          return "";
        }
        function getSourceInfoErrorAddendumForProps(elementProps) {
          if (elementProps !== null && elementProps !== void 0) {
            return getSourceInfoErrorAddendum(elementProps.__source);
          }
          return "";
        }
        var ownerHasKeyUseWarning = {};
        function getCurrentComponentErrorInfo(parentType) {
          var info = getDeclarationErrorAddendum();
          if (!info) {
            var parentName = typeof parentType === "string" ? parentType : parentType.displayName || parentType.name;
            if (parentName) {
              info = "\n\nCheck the top-level render call using <" + parentName + ">.";
            }
          }
          return info;
        }
        function validateExplicitKey(element, parentType) {
          if (!element._store || element._store.validated || element.key != null) {
            return;
          }
          element._store.validated = true;
          var currentComponentErrorInfo = getCurrentComponentErrorInfo(parentType);
          if (ownerHasKeyUseWarning[currentComponentErrorInfo]) {
            return;
          }
          ownerHasKeyUseWarning[currentComponentErrorInfo] = true;
          var childOwner = "";
          if (element && element._owner && element._owner !== ReactCurrentOwner.current) {
            childOwner = " It was passed a child from " + getComponentNameFromType(element._owner.type) + ".";
          }
          {
            setCurrentlyValidatingElement$1(element);
            error('Each child in a list should have a unique "key" prop.%s%s See https://reactjs.org/link/warning-keys for more information.', currentComponentErrorInfo, childOwner);
            setCurrentlyValidatingElement$1(null);
          }
        }
        function validateChildKeys(node, parentType) {
          if (typeof node !== "object") {
            return;
          }
          if (isArray(node)) {
            for (var i = 0; i < node.length; i++) {
              var child = node[i];
              if (isValidElement(child)) {
                validateExplicitKey(child, parentType);
              }
            }
          } else if (isValidElement(node)) {
            if (node._store) {
              node._store.validated = true;
            }
          } else if (node) {
            var iteratorFn = getIteratorFn(node);
            if (typeof iteratorFn === "function") {
              if (iteratorFn !== node.entries) {
                var iterator = iteratorFn.call(node);
                var step;
                while (!(step = iterator.next()).done) {
                  if (isValidElement(step.value)) {
                    validateExplicitKey(step.value, parentType);
                  }
                }
              }
            }
          }
        }
        function validatePropTypes(element) {
          {
            var type = element.type;
            if (type === null || type === void 0 || typeof type === "string") {
              return;
            }
            var propTypes;
            if (typeof type === "function") {
              propTypes = type.propTypes;
            } else if (typeof type === "object" && (type.$$typeof === REACT_FORWARD_REF_TYPE || // Note: Memo only checks outer props here.
            // Inner props are checked in the reconciler.
            type.$$typeof === REACT_MEMO_TYPE)) {
              propTypes = type.propTypes;
            } else {
              return;
            }
            if (propTypes) {
              var name = getComponentNameFromType(type);
              checkPropTypes(propTypes, element.props, "prop", name, element);
            } else if (type.PropTypes !== void 0 && !propTypesMisspellWarningShown) {
              propTypesMisspellWarningShown = true;
              var _name = getComponentNameFromType(type);
              error("Component %s declared `PropTypes` instead of `propTypes`. Did you misspell the property assignment?", _name || "Unknown");
            }
            if (typeof type.getDefaultProps === "function" && !type.getDefaultProps.isReactClassApproved) {
              error("getDefaultProps is only used on classic React.createClass definitions. Use a static property named `defaultProps` instead.");
            }
          }
        }
        function validateFragmentProps(fragment) {
          {
            var keys = Object.keys(fragment.props);
            for (var i = 0; i < keys.length; i++) {
              var key = keys[i];
              if (key !== "children" && key !== "key") {
                setCurrentlyValidatingElement$1(fragment);
                error("Invalid prop `%s` supplied to `React.Fragment`. React.Fragment can only have `key` and `children` props.", key);
                setCurrentlyValidatingElement$1(null);
                break;
              }
            }
            if (fragment.ref !== null) {
              setCurrentlyValidatingElement$1(fragment);
              error("Invalid attribute `ref` supplied to `React.Fragment`.");
              setCurrentlyValidatingElement$1(null);
            }
          }
        }
        function createElementWithValidation(type, props, children) {
          var validType = isValidElementType(type);
          if (!validType) {
            var info = "";
            if (type === void 0 || typeof type === "object" && type !== null && Object.keys(type).length === 0) {
              info += " You likely forgot to export your component from the file it's defined in, or you might have mixed up default and named imports.";
            }
            var sourceInfo = getSourceInfoErrorAddendumForProps(props);
            if (sourceInfo) {
              info += sourceInfo;
            } else {
              info += getDeclarationErrorAddendum();
            }
            var typeString;
            if (type === null) {
              typeString = "null";
            } else if (isArray(type)) {
              typeString = "array";
            } else if (type !== void 0 && type.$$typeof === REACT_ELEMENT_TYPE) {
              typeString = "<" + (getComponentNameFromType(type.type) || "Unknown") + " />";
              info = " Did you accidentally export a JSX literal instead of a component?";
            } else {
              typeString = typeof type;
            }
            {
              error("React.createElement: type is invalid -- expected a string (for built-in components) or a class/function (for composite components) but got: %s.%s", typeString, info);
            }
          }
          var element = createElement.apply(this, arguments);
          if (element == null) {
            return element;
          }
          if (validType) {
            for (var i = 2; i < arguments.length; i++) {
              validateChildKeys(arguments[i], type);
            }
          }
          if (type === REACT_FRAGMENT_TYPE) {
            validateFragmentProps(element);
          } else {
            validatePropTypes(element);
          }
          return element;
        }
        var didWarnAboutDeprecatedCreateFactory = false;
        function createFactoryWithValidation(type) {
          var validatedFactory = createElementWithValidation.bind(null, type);
          validatedFactory.type = type;
          {
            if (!didWarnAboutDeprecatedCreateFactory) {
              didWarnAboutDeprecatedCreateFactory = true;
              warn("React.createFactory() is deprecated and will be removed in a future major release. Consider using JSX or use React.createElement() directly instead.");
            }
            Object.defineProperty(validatedFactory, "type", {
              enumerable: false,
              get: function() {
                warn("Factory.type is deprecated. Access the class directly before passing it to createFactory.");
                Object.defineProperty(this, "type", {
                  value: type
                });
                return type;
              }
            });
          }
          return validatedFactory;
        }
        function cloneElementWithValidation(element, props, children) {
          var newElement = cloneElement.apply(this, arguments);
          for (var i = 2; i < arguments.length; i++) {
            validateChildKeys(arguments[i], newElement.type);
          }
          validatePropTypes(newElement);
          return newElement;
        }
        function startTransition(scope, options) {
          var prevTransition = ReactCurrentBatchConfig.transition;
          ReactCurrentBatchConfig.transition = {};
          var currentTransition = ReactCurrentBatchConfig.transition;
          {
            ReactCurrentBatchConfig.transition._updatedFibers = /* @__PURE__ */ new Set();
          }
          try {
            scope();
          } finally {
            ReactCurrentBatchConfig.transition = prevTransition;
            {
              if (prevTransition === null && currentTransition._updatedFibers) {
                var updatedFibersCount = currentTransition._updatedFibers.size;
                if (updatedFibersCount > 10) {
                  warn("Detected a large number of updates inside startTransition. If this is due to a subscription please re-write it to use React provided hooks. Otherwise concurrent mode guarantees are off the table.");
                }
                currentTransition._updatedFibers.clear();
              }
            }
          }
        }
        var didWarnAboutMessageChannel = false;
        var enqueueTaskImpl = null;
        function enqueueTask(task) {
          if (enqueueTaskImpl === null) {
            try {
              var requireString = ("require" + Math.random()).slice(0, 7);
              var nodeRequire = module2 && module2[requireString];
              enqueueTaskImpl = nodeRequire.call(module2, "timers").setImmediate;
            } catch (_err) {
              enqueueTaskImpl = function(callback) {
                {
                  if (didWarnAboutMessageChannel === false) {
                    didWarnAboutMessageChannel = true;
                    if (typeof MessageChannel === "undefined") {
                      error("This browser does not have a MessageChannel implementation, so enqueuing tasks via await act(async () => ...) will fail. Please file an issue at https://github.com/facebook/react/issues if you encounter this warning.");
                    }
                  }
                }
                var channel = new MessageChannel();
                channel.port1.onmessage = callback;
                channel.port2.postMessage(void 0);
              };
            }
          }
          return enqueueTaskImpl(task);
        }
        var actScopeDepth = 0;
        var didWarnNoAwaitAct = false;
        function act(callback) {
          {
            var prevActScopeDepth = actScopeDepth;
            actScopeDepth++;
            if (ReactCurrentActQueue.current === null) {
              ReactCurrentActQueue.current = [];
            }
            var prevIsBatchingLegacy = ReactCurrentActQueue.isBatchingLegacy;
            var result;
            try {
              ReactCurrentActQueue.isBatchingLegacy = true;
              result = callback();
              if (!prevIsBatchingLegacy && ReactCurrentActQueue.didScheduleLegacyUpdate) {
                var queue = ReactCurrentActQueue.current;
                if (queue !== null) {
                  ReactCurrentActQueue.didScheduleLegacyUpdate = false;
                  flushActQueue(queue);
                }
              }
            } catch (error2) {
              popActScope(prevActScopeDepth);
              throw error2;
            } finally {
              ReactCurrentActQueue.isBatchingLegacy = prevIsBatchingLegacy;
            }
            if (result !== null && typeof result === "object" && typeof result.then === "function") {
              var thenableResult = result;
              var wasAwaited = false;
              var thenable = {
                then: function(resolve, reject) {
                  wasAwaited = true;
                  thenableResult.then(function(returnValue2) {
                    popActScope(prevActScopeDepth);
                    if (actScopeDepth === 0) {
                      recursivelyFlushAsyncActWork(returnValue2, resolve, reject);
                    } else {
                      resolve(returnValue2);
                    }
                  }, function(error2) {
                    popActScope(prevActScopeDepth);
                    reject(error2);
                  });
                }
              };
              {
                if (!didWarnNoAwaitAct && typeof Promise !== "undefined") {
                  Promise.resolve().then(function() {
                  }).then(function() {
                    if (!wasAwaited) {
                      didWarnNoAwaitAct = true;
                      error("You called act(async () => ...) without await. This could lead to unexpected testing behaviour, interleaving multiple act calls and mixing their scopes. You should - await act(async () => ...);");
                    }
                  });
                }
              }
              return thenable;
            } else {
              var returnValue = result;
              popActScope(prevActScopeDepth);
              if (actScopeDepth === 0) {
                var _queue = ReactCurrentActQueue.current;
                if (_queue !== null) {
                  flushActQueue(_queue);
                  ReactCurrentActQueue.current = null;
                }
                var _thenable = {
                  then: function(resolve, reject) {
                    if (ReactCurrentActQueue.current === null) {
                      ReactCurrentActQueue.current = [];
                      recursivelyFlushAsyncActWork(returnValue, resolve, reject);
                    } else {
                      resolve(returnValue);
                    }
                  }
                };
                return _thenable;
              } else {
                var _thenable2 = {
                  then: function(resolve, reject) {
                    resolve(returnValue);
                  }
                };
                return _thenable2;
              }
            }
          }
        }
        function popActScope(prevActScopeDepth) {
          {
            if (prevActScopeDepth !== actScopeDepth - 1) {
              error("You seem to have overlapping act() calls, this is not supported. Be sure to await previous act() calls before making a new one. ");
            }
            actScopeDepth = prevActScopeDepth;
          }
        }
        function recursivelyFlushAsyncActWork(returnValue, resolve, reject) {
          {
            var queue = ReactCurrentActQueue.current;
            if (queue !== null) {
              try {
                flushActQueue(queue);
                enqueueTask(function() {
                  if (queue.length === 0) {
                    ReactCurrentActQueue.current = null;
                    resolve(returnValue);
                  } else {
                    recursivelyFlushAsyncActWork(returnValue, resolve, reject);
                  }
                });
              } catch (error2) {
                reject(error2);
              }
            } else {
              resolve(returnValue);
            }
          }
        }
        var isFlushing = false;
        function flushActQueue(queue) {
          {
            if (!isFlushing) {
              isFlushing = true;
              var i = 0;
              try {
                for (; i < queue.length; i++) {
                  var callback = queue[i];
                  do {
                    callback = callback(true);
                  } while (callback !== null);
                }
                queue.length = 0;
              } catch (error2) {
                queue = queue.slice(i + 1);
                throw error2;
              } finally {
                isFlushing = false;
              }
            }
          }
        }
        var createElement$1 = createElementWithValidation;
        var cloneElement$1 = cloneElementWithValidation;
        var createFactory = createFactoryWithValidation;
        var Children = {
          map: mapChildren,
          forEach: forEachChildren,
          count: countChildren,
          toArray,
          only: onlyChild
        };
        exports2.Children = Children;
        exports2.Component = Component;
        exports2.Fragment = REACT_FRAGMENT_TYPE;
        exports2.Profiler = REACT_PROFILER_TYPE;
        exports2.PureComponent = PureComponent;
        exports2.StrictMode = REACT_STRICT_MODE_TYPE;
        exports2.Suspense = REACT_SUSPENSE_TYPE;
        exports2.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = ReactSharedInternals;
        exports2.act = act;
        exports2.cloneElement = cloneElement$1;
        exports2.createContext = createContext;
        exports2.createElement = createElement$1;
        exports2.createFactory = createFactory;
        exports2.createRef = createRef;
        exports2.forwardRef = forwardRef;
        exports2.isValidElement = isValidElement;
        exports2.lazy = lazy;
        exports2.memo = memo;
        exports2.startTransition = startTransition;
        exports2.unstable_act = act;
        exports2.useCallback = useCallback;
        exports2.useContext = useContext;
        exports2.useDebugValue = useDebugValue;
        exports2.useDeferredValue = useDeferredValue;
        exports2.useEffect = useEffect;
        exports2.useId = useId;
        exports2.useImperativeHandle = useImperativeHandle;
        exports2.useInsertionEffect = useInsertionEffect;
        exports2.useLayoutEffect = useLayoutEffect;
        exports2.useMemo = useMemo;
        exports2.useReducer = useReducer;
        exports2.useRef = useRef;
        exports2.useState = useState;
        exports2.useSyncExternalStore = useSyncExternalStore2;
        exports2.useTransition = useTransition;
        exports2.version = ReactVersion;
        if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ !== "undefined" && typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop === "function") {
          __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop(new Error());
        }
      })();
    }
  }
});

// node_modules/react/index.js
var require_react = __commonJS({
  "node_modules/react/index.js"(exports2, module2) {
    "use strict";
    if (process.env.NODE_ENV === "production") {
      module2.exports = require_react_production_min();
    } else {
      module2.exports = require_react_development();
    }
  }
});

// tests/d91.entry.ts
var d91_entry_exports = {};
__export(d91_entry_exports, {
  EXPLAIN_ROUTER_MIN_CHARS: () => EXPLAIN_ROUTER_MIN_CHARS,
  EXPLAIN_ROUTER_THRESHOLD: () => EXPLAIN_ROUTER_THRESHOLD,
  EXPLAIN_ROUTER_WEIGHTS: () => EXPLAIN_ROUTER_WEIGHTS,
  EXPLAIN_SAME_TEXT_MIN_CHARS: () => EXPLAIN_SAME_TEXT_MIN_CHARS,
  EXPLAIN_SAME_TEXT_RATIO: () => EXPLAIN_SAME_TEXT_RATIO,
  STE_CATEGORIES: () => STE_CATEGORIES,
  STE_OUTPUT_LANG: () => STE_OUTPUT_LANG,
  STE_PROFILES: () => STE_PROFILES,
  formatProfile: () => formatProfile,
  isLikelySameText: () => isLikelySameText,
  parseSteMarkers: () => parseSteMarkers,
  resolveProfile: () => resolveProfile,
  routeExplainMode: () => routeExplainMode,
  steOutputLang: () => steOutputLang,
  steOutputLangName: () => steOutputLangName,
  stripSteMarkers: () => stripSteMarkers
});
module.exports = __toCommonJS(d91_entry_exports);

// src/lib/explainRouter.ts
var STE_CATEGORIES = [
  { key: "polysemy", zh: "\u4E00\u8BCD\u591A\u4E49" },
  { key: "pronoun-ref", zh: "\u6307\u4EE3\u4E0D\u660E" },
  { key: "long-nesting", zh: "\u957F\u53E5\u5D4C\u5957" },
  { key: "hidden-agent", zh: "\u65BD\u52A8\u8005\u9690\u85CF" },
  { key: "negation-stack", zh: "\u5426\u5B9A\u53E0\u52A0" },
  { key: "undefined-term", zh: "\u672F\u8BED\u672A\u5B9A\u4E49" },
  { key: "register-mix", zh: "\u8BED\u57DF\u6DF7\u6742" },
  { key: "quantity-vague", zh: "\u6570\u91CF\u542B\u7CCA" },
  { key: "idiom-figurative", zh: "\u6BD4\u55BB\u6210\u8BED" },
  { key: "missing-condition", zh: "\u9690\u542B\u524D\u63D0" }
];
var EXPLAIN_ROUTER_WEIGHTS = {
  /** 括号嵌套深度 ≥ 2（强结构嵌套信号） */
  nestingDeep: 2.2,
  /** 同一句内否定词 ≥ 2（否定叠加） */
  negationStack: 2.2,
  /** 被动标记 ≥ 2 处 */
  passiveMany: 1.6,
  /** 被动标记 = 1 处 */
  passiveOne: 0.8,
  /** 平均每句逗号/顿号/分号 ≥ 3（分句密集） */
  clauseDense: 1.2,
  /** 平均每句分句 ≥ 2（弱信号，需与其他特征叠加） */
  clauseSome: 0.6,
  /** 平均句长 ≥ 50 字符 */
  lengthAvg: 0.6,
  /** 最长句 ≥ 100 字符 */
  lengthMax: 0.6
};
var EXPLAIN_ROUTER_THRESHOLD = 2.2;
var EXPLAIN_ROUTER_MIN_CHARS = 20;
var SENTENCE_SPLIT = /[。！？!?；;\n]+/;
var CLAUSE_SPLIT = /[,，、;；]/g;
var NEGATION = /不|没|无|非|未|莫|勿|别|not\b|no\b|never\b|n't/gi;
var PASSIVE_ZH = /被|由[^，。；]{0,8}所|为[^，。；]{0,6}所/g;
var PASSIVE_EN = /\b(?:is|are|was|were|be|been|being)\s+\w+(?:ed|en)\b/gi;
function summarize(text) {
  const sentences = text.split(SENTENCE_SPLIT).map((s) => s.trim()).filter(Boolean);
  const n = Math.max(1, sentences.length);
  let totalLen = 0;
  let maxLen = 0;
  let clauses = 0;
  let maxBracketDepth = 0;
  let maxNegPerSentence = 0;
  let passiveCount = 0;
  for (const s of sentences) {
    totalLen += s.length;
    if (s.length > maxLen) maxLen = s.length;
    clauses += (s.match(CLAUSE_SPLIT) ?? []).length;
    maxBracketDepth = Math.max(maxBracketDepth, bracketDepth(s));
    maxNegPerSentence = Math.max(maxNegPerSentence, (s.match(NEGATION) ?? []).length);
    passiveCount += (s.match(PASSIVE_ZH) ?? []).length + (s.match(PASSIVE_EN) ?? []).length;
  }
  return {
    sentences,
    avgLen: totalLen / n,
    maxLen,
    clauseDensity: clauses / n,
    maxBracketDepth,
    maxNegPerSentence,
    passiveCount
  };
}
function bracketDepth(s) {
  const pairs = [
    ["\uFF08", "\uFF09"],
    ["(", ")"],
    ["\u3010", "\u3011"],
    ["[", "]"]
  ];
  let max = 0;
  for (const [open, close] of pairs) {
    let depth = 0;
    let deepest = 0;
    for (const ch of s) {
      if (ch === open) {
        depth += 1;
        if (depth > deepest) deepest = depth;
      } else if (ch === close && depth > 0) {
        depth -= 1;
      }
    }
    max = Math.max(max, deepest);
  }
  return max;
}
function routeExplainMode(text) {
  const src = String(text ?? "").trim();
  if (src.length < EXPLAIN_ROUTER_MIN_CHARS) return "general";
  const f = summarize(src);
  const w = EXPLAIN_ROUTER_WEIGHTS;
  let score = 0;
  if (f.maxBracketDepth >= 2) score += w.nestingDeep;
  if (f.maxNegPerSentence >= 2) score += w.negationStack;
  if (f.passiveCount >= 2) score += w.passiveMany;
  else if (f.passiveCount === 1) score += w.passiveOne;
  if (f.clauseDensity >= 3) score += w.clauseDense;
  else if (f.clauseDensity >= 2) score += w.clauseSome;
  if (f.avgLen >= 50) score += w.lengthAvg;
  if (f.maxLen >= 100) score += w.lengthMax;
  return score >= EXPLAIN_ROUTER_THRESHOLD ? "ste" : "general";
}
function parseSteMarkers(answer) {
  const out = {};
  const re = /<!--ste:([a-zA-Z]+)=([^>]*)-->/g;
  let m;
  while (m = re.exec(String(answer ?? ""))) {
    const key = m[1];
    const raw = m[2].trim();
    if (key === "matLang") out.matLang = raw || void 0;
    else if (key === "points") out.points = Number.isFinite(Number(raw)) ? Number(raw) : void 0;
    else if (key === "readings") out.readings = Number.isFinite(Number(raw)) ? Number(raw) : void 0;
  }
  return out;
}
function stripSteMarkers(answer) {
  return String(answer ?? "").replace(/<!--ste:[a-zA-Z]+=[^>]*-->/g, "");
}
var EXPLAIN_SAME_TEXT_RATIO = 0.6;
var EXPLAIN_SAME_TEXT_MIN_CHARS = 12;
function normalizeForOverlap(s) {
  return stripSteMarkers(s).toLowerCase().replace(/[\s`*_~>#|\-–—'"「」『』【】（）(){}[\]、，。；：！？.,;:!?"'`]/g, "");
}
function isLikelySameText(source, answer) {
  const a = normalizeForOverlap(source);
  const b = normalizeForOverlap(answer);
  if (a.length < EXPLAIN_SAME_TEXT_MIN_CHARS || b.length < a.length / 2) return false;
  const srcBigrams = /* @__PURE__ */ new Set();
  for (let i = 0; i < a.length - 1; i++) srcBigrams.add(a.slice(i, i + 2));
  if (srcBigrams.size === 0) return false;
  let hit = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    if (srcBigrams.has(g)) hit += 1;
  }
  const total = a.length - 1;
  return hit / total >= EXPLAIN_SAME_TEXT_RATIO;
}

// electron/ste-profiles/zh-Hans.json
var zh_Hans_default = {
  lang: "zh-Hans",
  name: "\u7B80\u660E\u4E2D\u6587\u5256\u9762 v1",
  derivedFrom: ["ISO 24495-1:2023", "ASD-STE100 Issue 9\uFF08\u4EC5\u7ED3\u6784\u53C2\u7167\uFF0C\u89C4\u5219\u6587\u5B57\u5168\u90E8\u81EA\u5199\u84B8\u998F\uFF09"],
  licenseNote: "original-wording: \u672C\u6587\u4EF6\u5168\u90E8\u89C4\u5219\u6587\u5B57\u4E3A\u81EA\u5199\uFF0C\u4E0D\u542B\u4EFB\u4F55\u53D7\u7248\u6743\u4FDD\u62A4\u7684\u89C4\u8303\u539F\u6587\u4E0E\u8BCD\u5178\u8BCD\u8868",
  sentence: {
    maxChars: 40,
    maxClauses: 2,
    note: "\u4E00\u53E5\u4E00\u4E49\uFF1B\u8D85\u8FC7\u7EA6 40 \u5B57\u6216\u542B\u4E24\u4E2A\u4EE5\u4E0A\u5206\u53E5\u7684\u957F\u53E5\u5FC5\u987B\u62C6\u5206\uFF1B\u4ECE\u53E5\u5D4C\u5957\u81F3\u591A\u4E00\u5C42\uFF1B\u4E00\u6BB5\u53EA\u8BF4\u4E00\u4E2A\u4E3B\u9898\uFF0C\u5148\u7ED3\u8BBA\u540E\u5C55\u5F00"
  },
  voice: {
    preferActive: true,
    agentUnknownNote: "\u4E3B\u52A8\u8BED\u6001\u4F18\u5148\uFF1B\u65BD\u52A8\u8005\u4E0D\u660E\u65F6\u663E\u5F0F\u5199\u300C\u6765\u6E90\u672A\u8BF4\u660E\u300D\uFF0C\u4E0D\u5F97\u7528\u88AB\u52A8\u53E5\u63A9\u853D\u65BD\u52A8\u8005"
  },
  lexicon: [
    "\u4E00\u8BCD\u4E00\u4E49\uFF1A\u540C\u4E00\u6982\u5FF5\u4ECE\u5934\u5230\u5C3E\u53EA\u7528\u540C\u4E00\u4E2A\u8BCD\uFF0C\u4E0D\u6362\u8FD1\u4E49\u8BCD",
    "\u907F\u514D\u6587\u767D\u5939\u6742\uFF08\u5982\u300C\u4E4B\u300D\u300C\u5176\u300D\u300C\u8005\u300D\u6DF7\u5728\u767D\u8BDD\u91CC\uFF09\u4E0E\u591A\u4E49\u6210\u8BED",
    "\u672F\u8BED\u9996\u6B21\u51FA\u73B0\u5C31\u7528\u4E00\u53E5\u767D\u8BDD\u5C31\u5730\u5B9A\u4E49\uFF0C\u4E4B\u540E\u518D\u76F4\u63A5\u4F7F\u7528\u8BE5\u672F\u8BED",
    "\u907F\u514D\u884C\u8BDD\u3001\u7F51\u7EDC\u8BED\u4E0E\u5916\u6587\u7F29\u5199\uFF1B\u786E\u9700\u7F29\u5199\u65F6\u9996\u6B21\u51FA\u73B0\u7ED9\u51FA\u5168\u79F0",
    "\u6570\u91CF\u4E0E\u6761\u4EF6\u5199\u660E\u786E\uFF1A\u6570\u5B57\u5E26\u5355\u4F4D\uFF0C\u91CF\u7EA7\u4E0D\u5199\u300C\u82E5\u5E72\u300D\u300C\u4E00\u4E9B\u300D\u8FD9\u7C7B\u542B\u7CCA\u8BCD"
  ],
  avoid: [
    { bad: "\u88AB\u2026\u2026\u6240\u2026\u2026\uFF08\u65BD\u52A8\u8005\u7F3A\u5931\u7684\u88AB\u52A8\u957F\u53E5\uFF09", why: "\u65BD\u52A8\u8005\u88AB\u9690\u85CF\uFF0C\u8BFB\u8005\u65E0\u6CD5\u5224\u65AD\u662F\u8C01\u505A\u7684" },
    { bad: "\u591A\u5C42\u300C\u7684\u300D\u5B57\u957F\u5B9A\u8BED\uFF08\u5982\u300C\u7531\u90E8\u95E8\u5236\u5B9A\u7684\u5173\u4E8E\u89C4\u8303\u6240\u5C5E\u673A\u6784\u884C\u4E3A\u7684\u529E\u6CD5\u300D\uFF09", why: "\u5B9A\u8BED\u5C42\u5C42\u53E0\u52A0\uFF0C\u4E2D\u5FC3\u8BED\u88AB\u63A8\u8FDC\uFF0C\u8BFB\u4E09\u904D\u624D\u6562\u65AD\u53E5" },
    { bad: "\u5BF9\u300C\u5176\u300D\u300C\u8BE5\u300D\u300C\u6B64\u300D\u7684\u8FDC\u8DDD\u79BB\u6307\u4EE3", why: "\u6307\u4EE3\u5BF9\u8C61\u9694\u53E5\u4E4B\u540E\uFF0C\u8BFB\u8005\u9700\u8981\u56DE\u6EAF\u731C\u6D4B" },
    { bad: "\u6587\u767D\u6DF7\u6742\u7684\u4E66\u9762\u8154\uFF08\u300C\u4E1A\u5DF2\u300D\u300C\u5982\u4E0A\u6240\u8FF0\u300D\u300C\u5179\u300D\uFF09", why: "\u8BED\u57DF\u6DF7\u6742\uFF0C\u666E\u901A\u8BFB\u8005\u4E0D\u719F\u6089\u65E7\u5F0F\u4E66\u9762\u8BCD" }
  ],
  rewriteExample: [
    {
      before: "\u672C\u65B9\u6CD5\u4E4B\u6240\u4EE5\u80FD\u591F\u88AB\u5E7F\u6CDB\u91C7\u7528\uFF0C\u4E43\u56E0\u5176\u7531\u4E1A\u754C\u6240\u516C\u8BA4\u4E4B\u6280\u672F\u8DEF\u7EBF\u6240\u652F\u6301\u3002",
      after: "\u4E1A\u754C\u516C\u8BA4\u8FD9\u6761\u6280\u672F\u8DEF\u7EBF\uFF0C\u6240\u4EE5\u672C\u65B9\u6CD5\u88AB\u5E7F\u6CDB\u91C7\u7528\u3002\uFF08\u6765\u6E90\u672A\u8BF4\u660E\u662F\u8C01\u516C\u8BA4\uFF09"
    }
  ],
  source: "docs/design/STE-PLAIN-DECODE-D91.md"
};

// electron/ste-profiles/zh-Hant.json
var zh_Hant_default = {
  lang: "zh-Hant",
  name: "\u7C21\u660E\u4E2D\u6587\u5256\u9762 v1\uFF08\u7E41\u9AD4\uFF09",
  derivedFrom: ["ISO 24495-1:2023", "ASD-STE100 Issue 9\uFF08\u50C5\u7D50\u69CB\u53C3\u7167\uFF0C\u898F\u5247\u6587\u5B57\u5168\u90E8\u81EA\u5BEB\u84B8\u993E\uFF09"],
  licenseNote: "original-wording: \u672C\u6A94\u5168\u90E8\u898F\u5247\u6587\u5B57\u70BA\u81EA\u5BEB\uFF0C\u4E0D\u542B\u4EFB\u4F55\u53D7\u7248\u6B0A\u4FDD\u8B77\u7684\u898F\u7BC4\u539F\u6587\u8207\u8A5E\u5F59\u8868",
  sentence: {
    maxChars: 30,
    maxClauses: 2,
    note: "\u4E00\u53E5\u4E00\u7FA9\uFF1B\u4E00\u53E5\u81F3\u591A\u7D04 30 \u5B57\uFF1B\u5206\u53E5\u81F3\u591A 2 \u500B\uFF1B\u5F9E\u53E5\u5D4C\u5957\u81F3\u591A\u4E00\u5C64\uFF1B\u4E00\u6BB5\u53EA\u8AAA\u4E00\u500B\u4E3B\u984C\uFF0C\u5148\u7D50\u8AD6\u5F8C\u5C55\u958B"
  },
  voice: {
    preferActive: true,
    agentUnknownNote: "\u4E3B\u52D5\u8A9E\u614B\u512A\u5148\uFF1B\u65BD\u52D5\u8005\u4E0D\u660E\u6642\u660E\u78BA\u5BEB\u300C\u4F86\u6E90\u672A\u8AAA\u660E\u300D\uFF0C\u4E0D\u5F97\u7528\u88AB\u52D5\u53E5\u63A9\u853D\u65BD\u52D5\u8005"
  },
  lexicon: [
    "\u4E00\u8A5E\u4E00\u7FA9\uFF1A\u540C\u4E00\u6982\u5FF5\u5F9E\u982D\u5230\u5C3E\u53EA\u7528\u540C\u4E00\u500B\u8A5E\uFF0C\u4E0D\u63DB\u8FD1\u7FA9\u8A5E",
    "\u907F\u514D\u6587\u767D\u593E\u96DC\u8207\u591A\u7FA9\u6210\u8A9E",
    "\u8853\u8A9E\u9996\u6B21\u51FA\u73FE\u5C31\u7528\u4E00\u53E5\u767D\u8A71\u5C31\u5730\u5B9A\u7FA9\uFF0C\u4E4B\u5F8C\u76F4\u63A5\u4F7F\u7528\u8A72\u8853\u8A9E",
    "\u907F\u514D\u884C\u8A71\u3001\u7DB2\u8DEF\u8A9E\u8207\u5916\u6587\u7E2E\u5BEB\uFF1B\u78BA\u9700\u7E2E\u5BEB\u6642\u9996\u6B21\u51FA\u73FE\u7D66\u51FA\u5168\u7A31",
    "\u6578\u91CF\u8207\u689D\u4EF6\u5BEB\u660E\u78BA\uFF1A\u6578\u5B57\u5E36\u55AE\u4F4D\uFF0C\u91CF\u7D1A\u4E0D\u5BEB\u300C\u82E5\u5E72\u300D\u300C\u4E00\u4E9B\u300D\u9019\u985E\u542B\u7CCA\u8A5E"
  ],
  avoid: [
    { bad: "\u88AB\u2026\u2026\u6240\u2026\u2026\uFF08\u65BD\u52D5\u8005\u7F3A\u5931\u7684\u88AB\u52D5\u9577\u53E5\uFF09", why: "\u65BD\u52D5\u8005\u88AB\u96B1\u85CF\uFF0C\u8B80\u8005\u7121\u6CD5\u5224\u65B7\u662F\u8AB0\u505A\u7684" },
    { bad: "\u591A\u5C64\u300C\u7684\u300D\u5B57\u9577\u5B9A\u8A9E", why: "\u5B9A\u8A9E\u5C64\u5C64\u758A\u52A0\uFF0C\u4E2D\u5FC3\u8A9E\u88AB\u63A8\u9060\uFF0C\u8B80\u8005\u96E3\u4EE5\u65B7\u53E5" },
    { bad: "\u5C0D\u300C\u5176\u300D\u300C\u8A72\u300D\u300C\u6B64\u300D\u7684\u9060\u8DDD\u96E2\u6307\u4EE3", why: "\u6307\u4EE3\u5C0D\u8C61\u9694\u53E5\u4E4B\u5F8C\uFF0C\u8B80\u8005\u9700\u8981\u56DE\u6EAF\u731C\u6E2C" },
    { bad: "\u6587\u767D\u6DF7\u96DC\u7684\u66F8\u9762\u8154\uFF08\u300C\u696D\u5DF2\u300D\u300C\u5982\u4E0A\u6240\u8FF0\u300D\u300C\u8332\u300D\uFF09", why: "\u8A9E\u57DF\u6DF7\u96DC\uFF0C\u666E\u901A\u8B80\u8005\u4E0D\u719F\u6089\u820A\u5F0F\u66F8\u9762\u8A5E" }
  ],
  rewriteExample: [
    { before: "\u672C\u65B9\u6CD5\u4E4B\u6240\u4EE5\u80FD\u5920\u88AB\u5EE3\u6CDB\u63A1\u7528\uFF0C\u4E43\u56E0\u5176\u7531\u696D\u754C\u6240\u516C\u8A8D\u4E4B\u6280\u8853\u8DEF\u7DDA\u6240\u652F\u6301\u3002", after: "\u696D\u754C\u516C\u8A8D\u9019\u689D\u6280\u8853\u8DEF\u7DDA\uFF0C\u6240\u4EE5\u672C\u65B9\u6CD5\u88AB\u5EE3\u6CDB\u63A1\u7528\u3002\uFF08\u4F86\u6E90\u672A\u8AAA\u660E\u662F\u8AB0\u516C\u8A8D\uFF09" }
  ],
  source: "docs/design/STE-EXPLAIN-D247.md"
};

// electron/ste-profiles/en.json
var en_default = {
  lang: "en",
  name: "Plain English Profile v1 (controlled-language distillation)",
  derivedFrom: ["ISO 24495-1:2023", "ASD-STE100 Issue 9 (structure reference only; all rule wording originally written)"],
  licenseNote: "original-wording: every rule sentence in this file is originally written; no copyrighted specification text or its word lists is reproduced",
  sentence: {
    maxWords: 20,
    maxSentencesPerParagraph: 6,
    note: "One instruction per sentence; one topic per paragraph (with a conclusion first); split sentences longer than about 20 words; keep relative clauses to at most one per sentence"
  },
  voice: {
    preferActive: true,
    agentUnknownNote: "Prefer the active voice and name the doer; when the doer is unknown, say so explicitly (for example 'the source does not state who approved this'); use the passive only when the doer is unknown or unimportant"
  },
  lexicon: [
    "One term, one meaning: use the same word for the same concept throughout the text",
    "Prefer everyday words; explain a technical term in plain words where it first appears",
    "Keep noun phrases short (about three words at most); do not stack nouns",
    "Use verbs in simple finite forms; do not reuse one word with several grammatical functions",
    "Make quantities and conditions explicit: give units with numbers and write ranges precisely"
  ],
  avoid: [
    { bad: "Long noun chains such as 'system configuration item version verification procedure'", why: "Stacked nouns hide who does what to what" },
    { bad: "Sentences where several things happen with only 'and' or 'which' to hold them together", why: "Readers lose track of the main statement" },
    { bad: "Vague quantifiers such as 'several', 'some', 'appropriate'", why: "The reader cannot act on an unspecified amount or condition" },
    { bad: "Idioms and figurative verbs (for example 'the market tanked')", why: "Figurative language does not survive translation and puzzles non-native readers" }
  ],
  rewriteExample: [
    {
      before: "The implementation of the utilization of this procedure is performed by the operator.",
      after: "The operator uses this procedure."
    }
  ],
  source: "docs/design/STE-PLAIN-DECODE-D91.md"
};

// electron/ste-profiles/ja.json
var ja_default = {
  lang: "ja",
  name: "\u3084\u3055\u3057\u3044\u65E5\u672C\u8A9E\u30D7\u30ED\u30D5\u30A1\u30A4\u30EB v1",
  derivedFrom: ["ISO 24495-1:2023", "\u3084\u3055\u3057\u3044\u65E5\u672C\u8A9E\uFF08\u516C\u958B\u3055\u308C\u3066\u3044\u308B\u624B\u5F15\u304D\u306E\u539F\u5247\u3092\u53C2\u7167\u3001\u672C\u30D5\u30A1\u30A4\u30EB\u306E\u6587\u8A00\u306F\u3059\u3079\u3066\u81EA\u4F5C\uFF09", "ASD-STE100 Issue 9\uFF08\u69CB\u9020\u53C2\u7167\u306E\u307F\uFF09"],
  licenseNote: "original-wording: \u672C\u30D5\u30A1\u30A4\u30EB\u306E\u898F\u5247\u6587\u306F\u3059\u3079\u3066\u81EA\u4F5C\u3067\u3042\u308A\u3001\u8457\u4F5C\u6A29\u3067\u4FDD\u8B77\u3055\u308C\u305F\u898F\u7BC4\u539F\u6587\u3084\u8A9E\u5F59\u30EA\u30B9\u30C8\u3092\u542B\u307E\u306A\u3044",
  sentence: {
    maxChars: 30,
    maxClauses: 2,
    note: "\u4E00\u6587\u4E00\u7FA9\u3002\u4E00\u6587\u306F\u304A\u3088\u305D30\u5B57\u307E\u3067\u3002\u5F93\u5C5E\u7BC0\u306F1\u3064\u307E\u3067\u3002\u6BB5\u843D\u306F1\u30C6\u30FC\u30DE\u3002\u7D50\u8AD6\u3092\u5148\u306B\u66F8\u304F\u3002"
  },
  voice: {
    preferActive: true,
    agentUnknownNote: "\u80FD\u52D5\u614B\u3092\u512A\u5148\u3057\u3001\u8AB0\u304C\u3059\u308B\u304B\u3092\u66F8\u304F\u3002\u52D5\u4F5C\u4E3B\u304C\u4E0D\u660E\u306A\u3068\u304D\u306F\u300C\u51FA\u5178\u306B\u306F\u8AB0\u304C\u884C\u3063\u305F\u304B\u66F8\u304B\u308C\u3066\u3044\u306A\u3044\u300D\u3068\u660E\u793A\u3059\u308B\u3002"
  },
  lexicon: [
    "\u540C\u3058\u6982\u5FF5\u306B\u306F\u540C\u3058\u8A00\u8449\u3092\u4F7F\u3044\u3001\u8A00\u3044\u63DB\u3048\u306A\u3044",
    "\u5C02\u9580\u7528\u8A9E\u306F\u65E5\u672C\u8A9E\u306E\u6A19\u6E96\u8868\u8A18\u3092\u4F7F\u3044\u3001\u521D\u51FA\u3067\u4E00\u6587\u8AAC\u660E\u3092\u6DFB\u3048\u308B\uFF08\u4F8B\uFF1A\u30DF\u30AF\u30ED\u30B0\u30EA\u30A2\u3001\u30B7\u30CA\u30D7\u30B9\u3001\u30D7\u30E9\u30FC\u30AF\u3001\u30B3\u30DB\u30FC\u30C8\u7814\u7A76\uFF09\u3002\u4E0D\u8981\u306A\u6F22\u8A9E\u8A33\u3084\u72EC\u81EA\u306E\u8A00\u3044\u63DB\u3048\u3092\u4F5C\u3089\u306A\u3044",
    "\u63A8\u91CF\u3068\u4E0D\u78BA\u5B9F\u6027\u3092\u4FDD\u3064\uFF08\u4F8B\uFF1A\u793A\u5506\u3059\u308B\u3001\u53EF\u80FD\u6027\u304C\u3042\u308B\u3001\u307E\u3060\u5206\u304B\u3089\u306A\u3044\uFF09\u3002\u300C\u793A\u3059\u300D\u300C\u8A3C\u660E\u3059\u308B\u300D\u306B\u8A00\u3044\u63DB\u3048\u306A\u3044",
    "\u6570\u91CF\u3068\u6761\u4EF6\u3092\u660E\u793A\u3059\u308B\u3002\u6570\u5024\u306B\u306F\u5358\u4F4D\u3092\u4ED8\u3051\u308B",
    "\u300C\u3044\u304F\u3064\u304B\u300D\u300C\u9069\u5F53\u306A\u300D\u306A\u3069\u306E\u66D6\u6627\u306A\u6570\u91CF\u8A5E\u3092\u4F7F\u308F\u306A\u3044"
  ],
  avoid: [
    { bad: "\u9577\u3044\u540D\u8A5E\u306E\u9023\u9396\uFF08\u4F8B\uFF1A\u300C\u30B7\u30B9\u30C6\u30E0\u8A2D\u5B9A\u9805\u76EE\u7248\u691C\u8A3C\u624B\u9806\u300D\uFF09", why: "\u4F55\u304C\u4F55\u3092\u3059\u308B\u306E\u304B\u5206\u304B\u3089\u306A\u304F\u306A\u308B" },
    { bad: "\u4E8C\u91CD\u5426\u5B9A\uFF08\u4F8B\uFF1A\u300C\u3067\u304D\u306A\u3044\u3053\u3068\u306F\u306A\u3044\u300D\uFF09", why: "\u8AAD\u8005\u304C\u610F\u5473\u3092\u53CD\u8EE2\u3055\u305B\u306A\u3051\u308C\u3070\u306A\u3089\u305A\u3001\u8AA4\u8AAD\u3057\u3084\u3059\u3044" },
    { bad: "\u6163\u7528\u53E5\u30FB\u6BD4\u55A9\uFF08\u4F8B\uFF1A\u300C\u5E02\u5834\u304C\u51B7\u3048\u8FBC\u3080\u300D\uFF09", why: "\u5B57\u9762\u304B\u3089\u610F\u5473\u3092\u53D6\u308C\u305A\u3001\u7FFB\u8A33\u3067\u3082\u901A\u3058\u306B\u304F\u3044" },
    { bad: "\u9060\u304F\u306E\u6307\u793A\u8A9E\uFF08\u4F8B\uFF1A\u6570\u6587\u524D\u306E\u540D\u8A5E\u3092\u300C\u3053\u308C\u300D\u3067\u53D7\u3051\u308B\uFF09", why: "\u8AAD\u8005\u304C\u524D\u3078\u623B\u3063\u3066\u78BA\u8A8D\u3059\u308B\u5FC5\u8981\u304C\u3042\u308B" }
  ],
  rewriteExample: [
    {
      before: "\u672C\u624B\u9806\u306E\u5229\u7528\u306E\u5B9F\u65BD\u306F\u3001\u62C5\u5F53\u8005\u306B\u3088\u3063\u3066\u884C\u308F\u308C\u308B\u3002",
      after: "\u62C5\u5F53\u8005\u304C\u3053\u306E\u624B\u9806\u3092\u4F7F\u3046\u3002"
    }
  ],
  source: "docs/design/STE-EXPLAIN-D247.md"
};

// electron/ste-profiles/universal.json
var universal_default = {
  lang: "universal",
  name: "Universal plain-language profile v1 (four principles)",
  derivedFrom: ["ISO 24495-1:2023"],
  licenseNote: "original-wording: \u672C\u6587\u4EF6\u5168\u90E8\u89C4\u5219\u6587\u5B57\u4E3A\u81EA\u5199\uFF0C\u4E0D\u542B\u4EFB\u4F55\u53D7\u7248\u6743\u4FDD\u62A4\u7684\u89C4\u8303\u539F\u6587\u4E0E\u8BCD\u8868",
  sentence: {
    note: "\u6309\u8BE5\u8BED\u8A00\u81EA\u5DF1\u7684\u4E60\u60EF\u5199\u77ED\u53E5\u3001\u76F4\u9648\u53E5\uFF1A\u4E00\u53E5\u53EA\u8BF4\u4E00\u4EF6\u4E8B\uFF0C\u5148\u7ED3\u8BBA\u540E\u5C55\u5F00\uFF0C\u4E00\u6BB5\u4E00\u4E2A\u4E3B\u9898\uFF08ISO \u56DB\u539F\u5219\u4E0D\u8BBE\u91CF\u5316\u53E5\u957F\uFF0C\u7531\u5404\u8BED\u8A00 pack \u7ED9\u51FA\u8FD1\u4F3C\u4E0A\u9650\uFF09"
  },
  voice: {
    preferActive: true,
    agentUnknownNote: "\u4E3B\u52A8\u8BED\u6001\u4F18\u5148\uFF0C\u5199\u660E\u300C\u8C01\u505A\u4E86\u4EC0\u4E48\u300D\uFF1B\u65BD\u52A8\u8005\u4E0D\u660E\u65F6\u660E\u8BF4\u300C\u6765\u6E90\u672A\u8BF4\u660E\u300D\uFF0C\u4E0D\u9760\u8BED\u6001\u63A9\u853D"
  },
  lexicon: [
    "\u8BFB\u8005\u80FD\u627E\u5230\uFF1A\u91CD\u8981\u5185\u5BB9\u653E\u524D\u9762\uFF0C\u6807\u9898\u4E0E\u8282\u5E8F\u7A33\u5B9A\uFF0C\u4E0D\u57CB\u5173\u952E\u4FE1\u606F",
    "\u8BFB\u8005\u80FD\u7406\u89E3\uFF1A\u7528\u8BE5\u8BED\u8A00\u7684\u5E38\u7528\u8BCD\uFF1B\u672F\u8BED\u9996\u73B0\u5C31\u5730\u7ED9\u4E00\u53E5\u5E73\u5B9E\u5B9A\u4E49\uFF1B\u4E00\u8BCD\u4E00\u4E49",
    "\u8BFB\u8005\u80FD\u4F7F\u7528\uFF1A\u6570\u91CF\u3001\u5355\u4F4D\u3001\u6761\u4EF6\u3001\u524D\u63D0\u5199\u660E\u786E\uFF0C\u4E0D\u5199\u542B\u7CCA\u91CF\u8BCD\uFF1B\u9690\u542B\u524D\u63D0\u663E\u5F0F\u5316",
    "\u76F8\u5173\uFF1A\u53EA\u5199\u4E0E\u8BFB\u8005\u4EFB\u52A1\u6709\u5173\u7684\u5185\u5BB9\uFF0C\u5220\u6389\u88C5\u9970\u6027\u94FA\u57AB"
  ],
  avoid: [
    { bad: "\u6307\u4EE3\u8DDD\u79BB\u8FC7\u8FDC\u7684\u4EE3\u8BCD\u4E0E\u7701\u7565\u4E3B\u8BED\u7684\u8FDE\u7EED\u5206\u53E5", why: "\u8BFB\u8005\u9700\u8981\u56DE\u6EAF\u4E0E\u731C\u6D4B\uFF0C\u8FDD\u53CD\u300C\u80FD\u7406\u89E3\u300D\u539F\u5219" },
    { bad: "\u6CA1\u6709\u5355\u4F4D\u6216\u754C\u9650\u7684\u6570\u91CF\u8BCD\uFF08\u82E5\u5E72\u3001\u4E00\u4E9B\u3001\u9002\u5F53\uFF09", why: "\u8BFB\u8005\u65E0\u6CD5\u636E\u6B64\u884C\u52A8\uFF0C\u8FDD\u53CD\u300C\u80FD\u4F7F\u7528\u300D\u539F\u5219" }
  ],
  rewriteExample: [
    {
      before: "\u7CFB\u7EDF\u5728\u7279\u5B9A\u6761\u4EF6\u4E0B\u53EF\u80FD\u4F1A\u51FA\u73B0\u4E00\u5B9A\u7A0B\u5EA6\u7684\u6027\u80FD\u6CE2\u52A8\u3002",
      after: "\u5F53\u5E76\u53D1\u7528\u6237\u8D85\u8FC7 200 \u65F6\uFF0C\u7CFB\u7EDF\u54CD\u5E94\u4F1A\u53D8\u6162\u7EA6 2 \u79D2\u3002\uFF08\u6765\u6E90\u672A\u8BF4\u660E\u8BE5\u9608\u503C\u7684\u6D4B\u5B9A\u6761\u4EF6\uFF09"
    }
  ],
  source: "docs/design/STE-PLAIN-DECODE-D91.md"
};

// src/lib/i18n.ts
var import_react = __toESM(require_react());

// src/i18n/zhTwOverrides.ts
var zhTwOverrides = {
  // —— 领域专名 ——
  "\u6750\u6599\u5BFC\u56FE": "\u6750\u6599\u5FC3\u667A\u5716",
  "\u5BFC\u56FE": "\u5FC3\u667A\u5716",
  "\u77E5\u8BC6\u56FE\u8C31": "\u77E5\u8B58\u5716\u8B5C",
  "\u5236\u5361": "\u88FD\u5361",
  "\u6279\u6CE8": "\u8A3B\u89E3",
  "\u5C31\u5730\u6279\u6CE8": "\u5C31\u5730\u8A3B\u89E3",
  "\u76AE\u80A4": "\u4F48\u666F",
  "\u6570\u636E": "\u8CC7\u6599",
  // —— 软件惯用语（台湾用法与 opencc 直转不同处） ——
  "\u4FDD\u5B58": "\u5132\u5B58",
  "\u6253\u5F00": "\u958B\u555F",
  "\u672C\u5730": "\u672C\u6A5F",
  "\u65E5\u5FD7": "\u65E5\u8A8C",
  "\u6E90\u4EE3\u7801": "\u539F\u59CB\u78BC",
  /* D223：台湾惯用「原始碼」而非 opencc 直转「源代碼」 */
  "\u97F3\u9891": "\u97F3\u8A0A",
  "\u62FC\u5199": "\u62FC\u5B57",
  "\u590D\u9009\u6846": "\u6838\u53D6\u65B9\u584A",
  "\u5FEB\u6377\u952E": "\u5FEB\u901F\u9375",
  "\u6298\u53E0": "\u647A\u758A",
  "\u6EDA\u52A8": "\u6372\u52D5",
  "\u5237\u65B0": "\u91CD\u65B0\u6574\u7406",
  "\u7C98\u8D34": "\u8CBC\u4E0A",
  "\u526A\u8D34\u677F": "\u526A\u8CBC\u7C3F",
  "\u64A4\u9500": "\u5FA9\u539F",
  "\u65B0\u5EFA": "\u65B0\u589E",
  "\u91CD\u547D\u540D": "\u91CD\u65B0\u547D\u540D",
  "\u6587\u4EF6\u5939": "\u8CC7\u6599\u593E",
  "\u56FE\u6807": "\u5716\u793A",
  "\u83DC\u5355": "\u9078\u55AE",
  "\u6062\u590D": "\u9084\u539F",
  "\u5907\u4EFD": "\u5099\u4EFD"
};

// src/lib/i18n.ts
var DEFAULT_LOCALE = "zh-CN";
var LANGUAGES = [
  { id: "zh-CN", name: "\u7B80\u4F53\u4E2D\u6587", htmlLang: "zh-Hans-CN" },
  { id: "zh-TW", name: "\u7E41\u9AD4\u4E2D\u6587", htmlLang: "zh-Hant-TW" },
  { id: "en", name: "English", htmlLang: "en" },
  { id: "ja", name: "\u65E5\u672C\u8A9E", htmlLang: "ja" }
];
var LOCALE_SET = new Set(LANGUAGES.map((l) => l.id));
var OVERRIDE_KEYS = Object.keys(zhTwOverrides).sort((a, b) => b.length - a.length);
var currentLocale = DEFAULT_LOCALE;
var LS_CACHE_KEY = "ir.locale";
function readLocaleCache() {
  try {
    const v = window.localStorage.getItem(LS_CACHE_KEY);
    return v && LOCALE_SET.has(v) ? v : null;
  } catch {
    return null;
  }
}
{
  const cached = typeof window !== "undefined" ? readLocaleCache() : null;
  if (cached) currentLocale = cached;
}
function getLocale() {
  return currentLocale;
}

// src/lib/steProfiles.ts
var STE_PROFILES = {
  "zh-Hans": zh_Hans_default,
  "zh-Hant": zh_Hant_default,
  en: en_default,
  ja: ja_default,
  universal: universal_default
};
var STE_OUTPUT_LANG = "zh-Hans";
function steOutputLang() {
  try {
    const loc = getLocale();
    if (loc === "en") return "en";
    if (loc === "ja") return "ja";
    if (loc === "zh-TW") return "zh-Hant";
    return "zh-Hans";
  } catch {
    return STE_OUTPUT_LANG;
  }
}
var STE_OUTPUT_LANG_NAMES = {
  "zh-Hans": "\u4E2D\u6587",
  "zh-Hant": "\u7E41\u9AD4\u4E2D\u6587",
  en: "English",
  ja: "\u65E5\u672C\u8A9E",
  ko: "\uD55C\uAD6D\uC5B4",
  fr: "Fran\xE7ais",
  de: "Deutsch",
  es: "Espa\xF1ol",
  ru: "\u0420\u0443\u0441\u0441\u043A\u0438\u0439",
  pt: "Portugu\xEAs",
  it: "Italiano"
};
function steOutputLangName(lang = steOutputLang()) {
  const raw = String(lang ?? "").trim().toLowerCase();
  if (raw) {
    for (const key of Object.keys(STE_OUTPUT_LANG_NAMES)) {
      if (key.toLowerCase() === raw) return STE_OUTPUT_LANG_NAMES[key];
    }
    const base = raw.split(/[-_]/)[0];
    if (base === "zh") return raw.includes("hant") || raw.includes("tw") || raw.includes("hk") || raw.includes("mo") ? STE_OUTPUT_LANG_NAMES["zh-Hant"] : STE_OUTPUT_LANG_NAMES["zh-Hans"];
    if (STE_OUTPUT_LANG_NAMES[base]) return STE_OUTPUT_LANG_NAMES[base];
  }
  return STE_OUTPUT_LANG_NAMES[steOutputLang()] ?? "\u4E2D\u6587";
}
function resolveProfile(lang) {
  const raw = String(lang ?? "").trim();
  if (raw) {
    const lower = raw.toLowerCase();
    const base = lower.split(/[-_]/)[0];
    for (const key of Object.keys(STE_PROFILES)) {
      if (key.toLowerCase() === lower) return STE_PROFILES[key];
    }
    if (base === "zh") {
      const hant = lower.includes("hant") || lower.includes("tw") || lower.includes("hk") || lower.includes("mo");
      return hant ? STE_PROFILES["zh-Hant"] : STE_PROFILES["zh-Hans"];
    }
    if (STE_PROFILES[base]) return STE_PROFILES[base];
    return STE_PROFILES.en;
  }
  return STE_PROFILES.universal;
}
function formatProfile(p) {
  const lines = [`\u3010${p.name}\uFF08${p.lang}\uFF09\u3011`];
  const s = p.sentence ?? {};
  const sentenceBits = [
    s.maxChars ? `\u4E00\u53E5 \u2264 ${s.maxChars} \u5B57` : "",
    s.maxWords ? `\u4E00\u53E5 \u2264 ${s.maxWords} words` : "",
    s.maxClauses ? `\u5206\u53E5 \u2264 ${s.maxClauses}` : "",
    s.maxSentencesPerParagraph ? `\u4E00\u6BB5 \u2264 ${s.maxSentencesPerParagraph} \u53E5` : "",
    s.note ?? ""
  ].filter(Boolean);
  if (sentenceBits.length) lines.push(`- \u53E5\u5B50\uFF1A${sentenceBits.join("\uFF1B")}`);
  if (p.voice?.preferActive !== void 0) {
    lines.push(`- \u8BED\u6001\uFF1A${p.voice.preferActive ? "\u4E3B\u52A8\u8BED\u6001\u4F18\u5148" : "\u4E0D\u5F3A\u5236\u4E3B\u52A8\u8BED\u6001"}${p.voice.agentUnknownNote ? `\uFF1B${p.voice.agentUnknownNote}` : ""}`);
  }
  for (const rule of p.lexicon ?? []) lines.push(`- \u8BCD\u6C47\uFF1A${rule}`);
  for (const a of p.avoid ?? []) lines.push(`- \u907F\u514D\uFF1A${a.bad}\u2014\u2014${a.why}`);
  for (const ex of p.rewriteExample ?? []) lines.push(`- \u6539\u5199\u793A\u4F8B\uFF1A\u539F\u300C${ex.before}\u300D\u2192 \u6539\u300C${ex.after}\u300D`);
  return lines.join("\n");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  EXPLAIN_ROUTER_MIN_CHARS,
  EXPLAIN_ROUTER_THRESHOLD,
  EXPLAIN_ROUTER_WEIGHTS,
  EXPLAIN_SAME_TEXT_MIN_CHARS,
  EXPLAIN_SAME_TEXT_RATIO,
  STE_CATEGORIES,
  STE_OUTPUT_LANG,
  STE_PROFILES,
  formatProfile,
  isLikelySameText,
  parseSteMarkers,
  resolveProfile,
  routeExplainMode,
  steOutputLang,
  steOutputLangName,
  stripSteMarkers
});
/*! Bundled license information:

react/cjs/react.production.min.js:
  (**
   * @license React
   * react.production.min.js
   *
   * Copyright (c) Facebook, Inc. and its affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

react/cjs/react.development.js:
  (**
   * @license React
   * react.development.js
   *
   * Copyright (c) Facebook, Inc. and its affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)
*/
