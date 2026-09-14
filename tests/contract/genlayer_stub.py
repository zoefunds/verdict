"""
Minimal stand-in for the `genlayer` package, used ONLY so
contracts/verdict_contract.py can be imported in a plain Python
environment to unit-test its deterministic, pure-Python helper functions
(verdict parsing, outcome coercion, settlement-band snapping, the
leader/validator equivalence check).

This is NOT a GenVM emulator and does not attempt to exercise anything
that touches actual GenVM runtime behavior — nondet LLM calls, web fetch,
message/sender context, or the payable-write escrow paths. Those require
the real GenLayer CLI (`genvm-lint`, `genlayer test`) against StudioNet or
a local GenVM instance, which is not installed in this environment. See
tests/contract/README.md for what is and is not covered here, and why.
"""

import sys
import types


def install() -> None:
    if "genlayer" in sys.modules:
        return

    genlayer = types.ModuleType("genlayer")

    # ---- primitive "types" — real values just need to be usable as type
    # annotations and behave like plain int/str at runtime for the pure
    # functions under test. ----
    u8 = int
    u16 = int
    u32 = int
    u64 = int
    u128 = int
    u256 = int
    Address = str

    class _Subscriptable:
        def __class_getitem__(cls, item):
            return cls

    class TreeMap(dict, _Subscriptable):
        pass

    class DynArray(list, _Subscriptable):
        pass

    def allow_storage(cls):
        return cls

    # ---- gl.* namespace ----
    gl = types.ModuleType("genlayer.gl")

    class UserError(Exception):
        def __init__(self, message):
            super().__init__(message)
            self.message = message

    class Return:
        def __init__(self, calldata=None):
            self.calldata = calldata

    vm = types.SimpleNamespace(
        UserError=UserError,
        Return=Return,
        run_nondet_unsafe=lambda leader, validator: leader(),
    )

    message = types.SimpleNamespace(sender_address="0x0", value=0)

    def exec_prompt(prompt, response_format=None):
        raise NotImplementedError("nondet exec_prompt is not available outside real GenVM")

    def web_render(url, mode=None):
        raise NotImplementedError("nondet web.render is not available outside real GenVM")

    nondet = types.SimpleNamespace(exec_prompt=exec_prompt, web=types.SimpleNamespace(render=web_render))

    def _identity_decorator(fn=None, **kwargs):
        if fn is None:
            return _identity_decorator
        return fn

    _identity_decorator.payable = _identity_decorator

    public = types.SimpleNamespace(write=_identity_decorator, view=_identity_decorator)

    def contract_interface(cls):
        return cls

    evm = types.SimpleNamespace(contract_interface=contract_interface)

    class Contract:
        """Real GenVM auto-initializes every class-annotated TreeMap/
        DynArray storage field to an empty container before __init__
        runs, so a contract's __init__ can immediately assign into them
        (e.g. `self.cases[cid] = ...`) without first constructing them.
        This stub's __new__ mimics that minimally — just enough for
        Verdict's real __init__ to run unmodified in tests that
        instantiate the actual contract class, not only its pure
        module-level functions."""

        def __new__(cls, *args, **kwargs):
            obj = super().__new__(cls)
            for klass in reversed(cls.__mro__):
                for name, annotation in getattr(klass, "__annotations__", {}).items():
                    # TreeMap/DynArray both list `dict`/`list` first in
                    # their bases, so Python's built-in PEP 585
                    # `__class_getitem__` (inherited from dict/list)
                    # shadows _Subscriptable's override — `TreeMap[X, Y]`
                    # is therefore a real `types.GenericAlias`, not the
                    # bare class, and its origin (not the alias itself)
                    # is what needs comparing here.
                    origin = getattr(annotation, "__origin__", annotation)
                    if origin is TreeMap:
                        setattr(obj, name, TreeMap())
                    elif origin is DynArray:
                        setattr(obj, name, DynArray())
            return obj

    gl.vm = vm
    gl.message = message
    gl.nondet = nondet
    gl.public = public
    gl.evm = evm
    gl.Contract = Contract

    genlayer.gl = gl
    genlayer.u8 = u8
    genlayer.u16 = u16
    genlayer.u32 = u32
    genlayer.u64 = u64
    genlayer.u128 = u128
    genlayer.u256 = u256
    genlayer.Address = Address
    genlayer.TreeMap = TreeMap
    genlayer.DynArray = DynArray
    genlayer.allow_storage = allow_storage

    genlayer.__all__ = [
        "gl",
        "u8",
        "u16",
        "u32",
        "u64",
        "u128",
        "u256",
        "Address",
        "TreeMap",
        "DynArray",
        "allow_storage",
    ]

    sys.modules["genlayer"] = genlayer
