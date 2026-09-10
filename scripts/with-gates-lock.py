#!/usr/bin/env python3
"""Serialize local validation using an OS-owned lock; no stale-file deletion.

Two callers share this wrapper (one lock implementation, one set of failure modes):
`gates` on /tmp/nomi-gates.lock, and the Ponytail review hook on /tmp/nomi-ponytail.lock
(--wait-timeout bounds the queue; --label says which lock is being waited on).

The inode stays in place: unlinking a flock file would allow two owners on two
inodes. The kernel releases dead owners, even after SIGKILL. On POSIX the foreground
command inherits its descriptor and retains it until its nested commands finish.
Background/detached tasks are outside this wrapper contract. Windows serializes
normal runs; killing its wrapper does not preserve a child-owned lock.
"""
import errno
import json
import os
import signal
import shlex
import subprocess
import sys
import tempfile
import time
import uuid

if os.name == 'nt':
    import msvcrt
else:
    import fcntl


def metadata(file):
    try:
        file.seek(1)
        return json.loads(file.read())
    except (ValueError, OSError):
        return {}


def try_lock(file):
    try:
        if os.name == 'nt':
            file.seek(0)
            msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except OSError as error:
        if error.errno not in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
            raise
        return False


def alive(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except (ValueError, TypeError, ProcessLookupError):
        return False
    except PermissionError:
        return True


def write_owner(file, owner):
    file.seek(0)
    file.write(' ' + json.dumps(owner))
    file.truncate()
    file.flush()


def inherited_owner(owner, token):
    if not token or token != owner.get('token') or owner.get('cwd') != os.getcwd():
        return False
    # Foreground nested commands stay in the outer command's process group.
    # Its descriptor owns the flock even when the supervising wrapper was killed.
    return alive(owner.get('pid')) or (
        os.name != 'nt' and owner.get('pgid') == os.getpgrp()
    )


def execute(command, shell, file, token, owner=None):
    env = {**os.environ, 'NOMI_GATES_LOCK_TOKEN': token}
    options = {'shell': shell, 'env': env}
    if os.name != 'nt':
        options.update(pass_fds=(file.fileno(),), start_new_session=owner is not None)
    child = subprocess.Popen(command, **options)
    if owner is not None and os.name != 'nt':
        owner['pgid'] = child.pid
        write_owner(file, owner)

    def cancel(signum, _frame):
        if child.poll() is None:
            try:
                if os.name == 'nt' or owner is None:
                    child.terminate()
                else:
                    os.killpg(child.pid, signum)
            except ProcessLookupError:
                pass

    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, cancel)
    code = child.wait()
    return code if code >= 0 else 128 - code


def parse_options(args):
    """Optional leading flags. Kept ahead of the command so `--`/`--command` still delimit it."""
    wait_timeout, label = None, 'gates'
    while len(args) >= 2 and args[0] in ('--wait-timeout', '--label'):
        if args[0] == '--wait-timeout':
            wait_timeout = float(args[1])
        else:
            label = args[1]
        args = args[2:]
    return wait_timeout, label, args


def main():
    wait_timeout, label, args = parse_options(sys.argv[1:])
    if len(args) >= 2 and args[0] == '--command':
        extra = subprocess.list2cmdline(args[2:]) if os.name == 'nt' else shlex.join(args[2:])
        command, shell = args[1] + (' ' + extra if extra else ''), True
    elif len(args) >= 2 and args[0] == '--':
        command, shell = args[1:], False
    else:
        raise SystemExit('Usage: with-gates-lock.py [--wait-timeout <秒>] [--label <名字>] -- <command> [args] | --command <shell command>')
    default = os.path.join(tempfile.gettempdir() if os.name == 'nt' else '/tmp', 'nomi-gates.lock')
    lock_path = os.environ.get('NOMI_GATES_LOCK_PATH', default)
    # O_NOFOLLOW prevents accidentally opening a symlink in the shared tmp dir.
    fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    with os.fdopen(fd, 'r+', encoding='utf-8') as file:
        token = os.environ.get('NOMI_GATES_LOCK_TOKEN', '')
        next_report = 0
        deadline = None if wait_timeout is None else time.monotonic() + wait_timeout
        while not try_lock(file):
            owner = metadata(file)
            if inherited_owner(owner, token):
                return execute(command, shell, file, token)
            if time.monotonic() >= next_report:
                minutes = max(0, (time.time() - owner.get('started', time.time())) / 60)
                print(f"另一棵 worktree 在跑 {label}（pid={owner.get('pid', '?')} cwd={owner.get('cwd', '?')} 已跑 {minutes:.1f} 分钟）；排队等待", file=sys.stderr, flush=True)
                next_report = time.monotonic() + 30
            # 等锁封顶后 fail-closed（EX_TEMPFAIL）：调用方该重试或走留痕延后，不许并跑。
            if deadline is not None and time.monotonic() >= deadline:
                print(f"等 {label} 锁超过 {wait_timeout:.0f} 秒（占用者 pid={owner.get('pid', '?')} cwd={owner.get('cwd', '?')}）；放弃排队", file=sys.stderr, flush=True)
                return 75
            time.sleep(0.2)
        token = uuid.uuid4().hex
        owner = {'pid': os.getpid(), 'cwd': os.getcwd(), 'started': time.time(), 'token': token}
        write_owner(file, owner)
        return execute(command, shell, file, token, owner)


if __name__ == '__main__':
    sys.exit(main())
