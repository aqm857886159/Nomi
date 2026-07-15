#!/usr/bin/env python3
"""
微信 4.x db_key 内存扫描取钥器（lldb Python 命令脚本）。

为什么这么做（实查 2026-07-15，多源交叉验证）：
  微信 4.x 用 WCDB(SQLCipher4) 加密本地库，raw key 派生后**以 ASCII 字符串 `x'<64hex key><32hex salt>'`
  缓存在进程内存**（99 字符）。macOS 微信默认 Hardened Runtime 挡 task_for_pid，需先 ad-hoc 重签
  (`sudo codesign --force --deep --sign - /Applications/WeChat.app`) 才能被 lldb attach 读内存——**不用关 SIP**。
  4.1.x 上纯 Mach VM 扫描会 "no memory regions found"，lldb attach 后遍历内存区域最稳。

它做什么：attach 微信进程 → 遍历可读内存找 `x'[0-9a-f]{96}'` → 每个候选前 64 hex=key、后 32 hex=salt →
  用 salt 匹配 xwechat_files 下每个 .db 文件 page1 前 16 字节（SQLCipher salt 是明文库头）→ 输出
  {db 文件: key} 映射，并判断**是不是所有库同一个 raw key**（决定 WeLive 单 db_key 模型行不行）。

它不做什么：不解密、不导出、不改微信任何东西。纯只读内存扫描。取到的 key 是敏感物，只写 stdout（由
  上层脚本填进 ~/welive/welive.yaml，不入库、不打印完整 key 到共享日志）。

用法（上层 welive-setup-mac.sh 会自动调）：
  sudo lldb --batch -p $(pgrep -x WeChat) \
    -o "command script import scripts/lib/feedback/dump-wechat-key.py" \
    -o "dump_wechat_key --root ~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files --session-only" \
    -o "quit"
"""

import glob
import json
import os
import re
import shlex

KEY_RE = re.compile(rb"x'([0-9a-fA-F]{96})'")
CHUNK = 8 * 1024 * 1024  # 8MB 分块读，避免一次性拉整段大区域
SALT_SZ = 16  # SQLCipher page1 前 16 字节 = salt（明文库头）


def _iter_db_salts(root):
    """xwechat_files 下每个 .db → {salt_hex: db_path}。salt = page1 前 16 字节。"""
    salts = {}
    for db in glob.glob(os.path.join(os.path.expanduser(root), "**", "*.db"), recursive=True):
        try:
            with open(db, "rb") as f:
                head = f.read(SALT_SZ)
            if len(head) == SALT_SZ:
                salts[head.hex().lower()] = db
        except OSError:
            continue
    return salts


def _scan_memory_for_keys(process):
    """遍历可读内存区域，收集所有 `x'<96hex>'` 候选（去重）。返回 set(96hex lower)。"""
    import lldb

    found = set()
    regions = process.GetMemoryRegions()
    info = lldb.SBMemoryRegionInfo()
    for i in range(regions.GetSize()):
        if not regions.GetMemoryRegionAtIndex(i, info):
            continue
        if not info.IsReadable():
            continue
        base = info.GetRegionBase()
        end = info.GetRegionEnd()
        addr = base
        # 分块读，块间留 100 字节重叠，防 pattern 跨块被截断
        while addr < end:
            size = min(CHUNK, end - addr)
            err = lldb.SBError()
            data = process.ReadMemory(addr, size, err)
            if err.Success() and data:
                for m in KEY_RE.finditer(data):
                    found.add(m.group(1).decode("ascii").lower())
            addr += size - 100 if size == CHUNK else size
    return found


def dump_wechat_key(debugger, command, result, internal_dict):
    args = shlex.split(command or "")
    root = "~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files"
    session_only = False
    it = iter(args)
    for a in it:
        if a == "--root":
            root = next(it, root)
        elif a == "--session-only":
            session_only = True

    salts = _iter_db_salts(root)
    if not salts:
        print(json.dumps({"status": "error", "message": f"xwechat_files 下没找到 .db（root={root}）"}))
        return

    process = debugger.GetSelectedTarget().GetProcess()
    if not process or not process.IsValid():
        print(json.dumps({"status": "error", "message": "没 attach 到微信进程（重签了吗？微信在跑吗？）"}))
        return

    candidates = _scan_memory_for_keys(process)

    # 候选后 32 hex(=16 字节 salt) 匹配到具体 db → {db: raw_key(前64hex)}
    db_to_key = {}
    for cand in candidates:
        raw_key, salt_hex = cand[:64], cand[64:]
        db = salts.get(salt_hex)
        if db:
            db_to_key[db] = raw_key

    if not db_to_key:
        print(json.dumps({
            "status": "no_match",
            "message": f"扫到 {len(candidates)} 个 key 候选，但没一个 salt 匹配上库文件——"
                       "微信可能还没打开这些库（WCDB lazy-open，登录后点开聊天再试），或版本形态变了",
            "candidates": len(candidates),
            "dbs": len(salts),
        }))
        return

    # 是不是所有库同一个 raw key？（决定 WeLive 单 db_key 模型行不行）
    unique_keys = set(db_to_key.values())
    single_raw_key = len(unique_keys) == 1

    session_db = next((db for db in db_to_key if os.path.join("session", "session.db") in db), None)
    session_key = db_to_key.get(session_db) if session_db else None

    out = {
        "status": "ok",
        "single_raw_key": single_raw_key,  # True → WeLive 单 db_key 可解全部库
        "matched_dbs": len(db_to_key),
        "total_dbs": len(salts),
        "session_db": session_db,
        "session_key": session_key,  # 敏感：上层填进 welive.yaml，不外发
        # 脱敏映射（只给库名 + key 前 8 位，供人核对是否单一 key，不泄全 key）
        "db_key_preview": {os.path.basename(db): k[:8] + "…" for db, k in sorted(db_to_key.items())},
    }
    print("WECHAT_KEY_JSON " + json.dumps(out, ensure_ascii=False))


def __lldb_init_module(debugger, internal_dict):
    debugger.HandleCommand("command script add -f dump_wechat_key.dump_wechat_key dump_wechat_key")
