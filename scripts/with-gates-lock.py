#!/usr/bin/env python3
"""Serialize local validation using an OS-owned lock; no stale-file deletion.

Local validation (`gates` and the suites it fans out to) serializes on
/tmp/nomi-gates.lock. One lock implementation, one set of failure modes.

The inode stays in place: unlinking a flock file would allow two owners on two
inodes. The kernel releases dead owners, even after SIGKILL. On POSIX the foreground
command inherits its descriptor and retains it until its nested commands finish.
Background/detached tasks are outside this wrapper contract. Windows serializes
normal runs; killing its wrapper does not preserve a child-owned lock.
"""
import errno
import json
import os
import re
import shlex
import signal
import stat
import subprocess
import sys
import tempfile
import time
import uuid

if os.name == 'nt':
    import ctypes
    from ctypes import wintypes
    import msvcrt

    # Windows has no signals: CPython maps os.kill(pid, 0) onto
    # GenerateConsoleCtrlEvent(CTRL_C_EVENT=0, pid), which interrupts every
    # process sharing that console (issue #838: it killed the host backend).
    # Observing a process object is the read-only equivalent.
    PROCESS_SYNCHRONIZE = 0x00100000
    ERROR_INVALID_PARAMETER = 87
    ERROR_ACCESS_DENIED = 5
    WAIT_OBJECT_0 = 0
    WAIT_TIMEOUT = 258
    _kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    _kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    _kernel32.OpenProcess.restype = wintypes.HANDLE
    _kernel32.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
    _kernel32.WaitForSingleObject.restype = wintypes.DWORD
    _kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    _kernel32.CloseHandle.restype = wintypes.BOOL
else:
    import fcntl


def metadata(file):
    try:
        file.seek(1)
        return json.loads(file.read())
    except (ValueError, OSError):
        return {}


def try_lock(file):
    ensure_lock_byte(file)
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


def lock_blocking(file):
    ensure_lock_byte(file)
    if os.name == 'nt':
        # LK_LOCK retries only ten times (about ten seconds) before raising.
        # Guard admission may scan an arbitrarily long live queue, so keep the
        # same non-blocking primitive as the main lock and retry without a cap.
        while not try_lock(file):
            time.sleep(0.2)
    else:
        fcntl.flock(file, fcntl.LOCK_EX)


def unlock(file):
    if os.name == 'nt':
        file.seek(0)
        msvcrt.locking(file.fileno(), msvcrt.LK_UNLCK, 1)
    else:
        fcntl.flock(file, fcntl.LOCK_UN)


def ensure_lock_byte(file):
    file.seek(0, os.SEEK_END)
    if file.tell() == 0:
        file.write('0')
        file.flush()
    file.seek(0)


def open_lock_file(path, create=True):
    flags = os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0)
    if create:
        flags |= os.O_CREAT
    fd = os.open(path, flags, 0o600)
    file = os.fdopen(fd, 'r+', encoding='utf-8')
    ensure_lock_byte(file)
    return file


def ensure_queue_dir(path):
    try:
        os.mkdir(path, 0o700)
    except FileExistsError:
        if stat.S_ISLNK(os.lstat(path).st_mode) or not stat.S_ISDIR(os.stat(path).st_mode):
            raise RuntimeError(f'排队状态不是目录：{path}')
    except OSError as error:
        raise RuntimeError(f'排队状态打不开：{path}: {error}') from error


def open_queue(lock_path):
    queue_path = f'{lock_path}.queue'
    ensure_queue_dir(queue_path)
    try:
        guard = open_lock_file(os.path.join(queue_path, 'guard.lock'))
        counter_fd = os.open(
            os.path.join(queue_path, 'counter'),
            os.O_RDWR | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0),
            0o600,
        )
        counter = os.fdopen(counter_fd, 'r+', encoding='utf-8')
    except OSError as error:
        raise RuntimeError(f'排队状态打不开：{queue_path}: {error}') from error
    return queue_path, guard, counter


TICKET_RE = re.compile(r'^ticket-(\d{20})\.lock$')


def ticket_numbers(queue_path):
    try:
        names = os.listdir(queue_path)
    except OSError as error:
        raise RuntimeError(f'排队状态打不开：{queue_path}: {error}') from error
    numbers = []
    for name in names:
        match = TICKET_RE.fullmatch(name)
        if match:
            numbers.append(int(match.group(1)))
        elif name.startswith('ticket-'):
            raise RuntimeError(f'排队状态损坏：{os.path.join(queue_path, name)}')
    return sorted(numbers)


def ticket_path(queue_path, number):
    return os.path.join(queue_path, f'ticket-{number:020d}.lock')


def ticket_file(queue_path, number, create=True):
    return open_lock_file(ticket_path(queue_path, number), create=create)


def remove_ticket(path):
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass
    except OSError:
        # Windows can deny unlink while another handle still has the file
        # open. The next guard admission will retry; cleanup is best effort.
        pass


def allocate_ticket(queue_path, counter):
    counter.seek(0)
    raw = counter.read().strip()
    if raw and not raw.isdigit():
        raise RuntimeError(f'排队计数器损坏：{os.path.join(queue_path, "counter")}')
    number = int(raw or '0')
    ticket = ticket_file(queue_path, number)
    if not try_lock(ticket):
        ticket.close()
        raise RuntimeError(f'排队票号已被占用：{number}')
    counter.seek(0)
    counter.write(str(number + 1))
    counter.truncate()
    counter.flush()
    os.fsync(counter.fileno())
    return number, ticket, ticket_path(queue_path, number)


def active_ticket_numbers(queue_path, before=None):
    active = []
    for number in ticket_numbers(queue_path):
        if before is not None and number >= before:
            continue
        try:
            ticket = ticket_file(queue_path, number, create=False)
        except FileNotFoundError:
            continue
        try:
            if try_lock(ticket):
                unlock(ticket)
            else:
                active.append(number)
        finally:
            ticket.close()
    return active


def cleanup_dead_tickets(queue_path):
    """Remove only unlocked ticket files, and only while the caller owns guard."""
    for number in ticket_numbers(queue_path):
        path = ticket_path(queue_path, number)
        try:
            ticket = ticket_file(queue_path, number, create=False)
        except FileNotFoundError:
            continue
        reclaimed = False
        try:
            if try_lock(ticket):
                unlock(ticket)
                reclaimed = True
        finally:
            ticket.close()
        if reclaimed:
            remove_ticket(path)


def queue_notice(owner, count):
    minutes = max(0, (time.time() - owner.get('started', time.time())) / 60)
    print(
        f"前面还有 {count} 个（正在跑：pid={owner.get('pid', '?')} cwd={owner.get('cwd', '?')} 已跑 {minutes:.1f} 分钟）；排队等待",
        file=sys.stderr,
        flush=True,
    )


def alive(pid):
    """Read-only liveness of a lock owner. Never signals, never terminates.

    A false positive hands the shared lock to a caller that cannot really
    inherit it, so unknown states raise instead of guessing.
    """
    # Rejecting non-positive-int pids up front keeps 0 (= "my own console
    # group" on Windows, "my process group" on POSIX), negatives, bools and
    # junk metadata out of the system call.
    if type(pid) is not int or pid <= 0:
        return False
    if os.name == 'nt':
        if pid > 0xFFFFFFFF:  # not a DWORD, so not a pid
            return False
        handle = _kernel32.OpenProcess(PROCESS_SYNCHRONIZE, False, pid)
        if not handle:
            error = ctypes.get_last_error()
            if error == ERROR_INVALID_PARAMETER:  # no process carries this id
                return False
            if error == ERROR_ACCESS_DENIED:  # exists, just not ours to open
                return True
            raise ctypes.WinError(error)
        try:
            # Zero-wait on the process object: signaled means it has exited.
            # GetExitCodeProcess alone cannot tell STILL_ACTIVE from a process
            # that really exited with that very code.
            state = _kernel32.WaitForSingleObject(handle, 0)
            if state == WAIT_TIMEOUT:
                return True
            if state == WAIT_OBJECT_0:
                return False
            raise ctypes.WinError(ctypes.get_last_error())  # WAIT_FAILED etc.
        finally:
            _kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except (OverflowError, ProcessLookupError):
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
    child = None
    pending_signal = None

    def cancel(signum, _frame):
        nonlocal pending_signal
        if child is None:
            pending_signal = signum
            return
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
    child = subprocess.Popen(command, **options)
    if owner is not None and os.name != 'nt':
        owner['pgid'] = child.pid
        write_owner(file, owner)
    if pending_signal is not None:
        cancel(pending_signal, None)
    code = child.wait()
    return code if code >= 0 else 128 - code


def main():
    args = sys.argv[1:]
    if len(args) >= 2 and args[0] == '--command':
        extra = subprocess.list2cmdline(args[2:]) if os.name == 'nt' else shlex.join(args[2:])
        command, shell = args[1] + (' ' + extra if extra else ''), True
    elif len(args) >= 2 and args[0] == '--':
        command, shell = args[1:], False
    else:
        raise SystemExit('Usage: with-gates-lock.py -- <command> [args] | --command <shell command>')
    default = os.path.join(tempfile.gettempdir() if os.name == 'nt' else '/tmp', 'nomi-gates.lock')
    lock_path = os.environ.get('NOMI_GATES_LOCK_PATH', default)
    # O_NOFOLLOW prevents accidentally opening a symlink in the shared tmp dir.
    fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    with os.fdopen(fd, 'r+', encoding='utf-8') as file:
        try:
            queue_path, guard, counter = open_queue(lock_path)
        except (OSError, RuntimeError) as error:
            raise SystemExit(str(error)) from error
        token = os.environ.get('NOMI_GATES_LOCK_TOKEN', '')
        next_report = 0
        last_ahead = None
        ticket_number = None
        ticket = None
        ticket_pathname = None
        try:
            # The queue guard is acquired before every admission decision. This
            # closes the gap in which a late caller could grab a just-released
            # main lock while an earlier waiter was registering its ticket.
            lock_blocking(guard)
            try:
                cleanup_dead_tickets(queue_path)
                owner = metadata(file)
                owns_lock = try_lock(file)
                queued = active_ticket_numbers(queue_path)
                if owns_lock and not queued:
                    token = uuid.uuid4().hex
                    owner = {'pid': os.getpid(), 'cwd': os.getcwd(), 'started': time.time(), 'token': token}
                    write_owner(file, owner)
                    direct = True
                elif owns_lock:
                    unlock(file)
                    ticket_number, ticket, ticket_pathname = allocate_ticket(queue_path, counter)
                    direct = False
                elif inherited_owner(owner, token):
                    direct = None
                else:
                    ticket_number, ticket, ticket_pathname = allocate_ticket(queue_path, counter)
                    direct = False
            finally:
                unlock(guard)

            if direct is None:
                return execute(command, shell, file, token)
            if direct:
                return execute(command, shell, file, token, owner)

            def cancel_wait(signum, _frame):
                raise SystemExit(128 + signum)

            for sig in (signal.SIGTERM, signal.SIGINT):
                signal.signal(sig, cancel_wait)
            while True:
                owner = metadata(file)
                ahead = len(active_ticket_numbers(queue_path, before=ticket_number))
                if ahead == 0 and try_lock(file):
                    unlock(ticket)
                    ticket.close()
                    remove_ticket(ticket_pathname)
                    ticket = None
                    ticket_pathname = None
                    token = uuid.uuid4().hex
                    owner = {'pid': os.getpid(), 'cwd': os.getcwd(), 'started': time.time(), 'token': token}
                    write_owner(file, owner)
                    return execute(command, shell, file, token, owner)
                if ahead != last_ahead or time.monotonic() >= next_report:
                    queue_notice(owner, ahead)
                    last_ahead = ahead
                    next_report = time.monotonic() + 30
                time.sleep(0.2)
        finally:
            if ticket is not None:
                ticket.close()
                remove_ticket(ticket_pathname)
            counter.close()
            guard.close()


if __name__ == '__main__':
    sys.exit(main())
