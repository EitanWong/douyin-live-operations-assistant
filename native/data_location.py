"""One durable location decision, serialized across native hosts and CLI commands."""
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import time
import uuid

from data_store import DataStore, default_database


class LocationError(ValueError):
    pass


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def save_json(path, value):
    fd, temporary = tempfile.mkstemp(prefix='.data-settings-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        Path(temporary).unlink(missing_ok=True)


def absolute_path(value):
    if not isinstance(value, str) or not value.strip() or '\x00' in value:
        raise LocationError('请填写本机文件夹的完整绝对路径')
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise LocationError('请填写本机文件夹的完整绝对路径')
    return path.resolve()


class DataLocation:
    def __init__(self, settings=None, fallback=None, database=None):
        self.settings = Path(settings or default_database().parent.parent/'data-settings.json').resolve()
        self.fallback = Path(fallback or default_database()).resolve()
        self.override = absolute_path(database) if database else None
        self.journal = self.settings.with_suffix('.migration.json')

    @contextmanager
    def lock(self):
        self.settings.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd = os.open(self.settings.with_suffix('.lock'), os.O_CREAT | os.O_RDWR, 0o600)
        deadline = time.monotonic()+12
        try:
            while True:
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise LocationError('数据库正在迁移或处理其他任务，请稍后重试；待写数据仍保留')
                    time.sleep(.05)
            yield
        finally:
            os.close(fd)

    def current(self):
        if not self.settings.exists():
            return self.fallback
        try:
            config = json.loads(self.settings.read_text(encoding='utf-8'))
            if config['schemaVersion'] != 1:
                raise ValueError()
            return absolute_path(config['database'])
        except (ValueError, KeyError, TypeError) as error:
            raise LocationError('存储位置配置无效，未退回默认目录，请恢复配置文件') from error

    def recover(self):
        if not self.journal.exists():
            return
        migration = json.loads(self.journal.read_text(encoding='utf-8'))
        source, target, stage = (absolute_path(migration[k]) for k in ('source', 'target', 'stage'))
        if stage.parent != target.parent or not stage.name.startswith('.douyin-migration-') or source == target:
            raise LocationError('存储迁移记录无效，未切换数据库')
        current = self.current()
        if current == target:
            if not target.is_file():
                raise LocationError('新数据库不可用，请连接存储设备后重试')
        else:
            if current != source or not source.is_file():
                raise LocationError('原数据库不可用，迁移尚未完成')
            if target.exists():
                if not stage.is_file() or not os.path.samefile(stage, target):
                    raise LocationError('目标数据库已存在，未覆盖；请使用其他空文件夹')
            else:
                stage.unlink(missing_ok=True)
                store = DataStore(source)
                try:
                    store.backup(stage)
                finally:
                    store.close()
                with stage.open('rb') as stream:
                    os.fsync(stream.fileno())
                check = sqlite3.connect(stage.as_uri()+'?mode=ro', uri=True)
                try:
                    if check.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                        raise LocationError('数据库副本校验失败，未切换存储位置')
                finally:
                    check.close()
                # Same-directory hard link publishes without overwriting any user file.
                os.link(stage, target)
                sync_directory(target.parent)
            save_json(self.settings, {'schemaVersion': 1, 'database': str(target)})
        self.journal.unlink()
        sync_directory(self.settings.parent)
        stage.unlink(missing_ok=True)
        sync_directory(target.parent)

    @contextmanager
    def open(self):
        with self.lock():
            self.recover()
            path = self.override or self.current()
            if not self.override and self.settings.exists() and not path.is_file():
                raise LocationError('已配置的数据库不可用，请连接存储设备；未创建空库替代')
            store = DataStore(path)
            try:
                yield store
            finally:
                store.close()

    def relocate(self, directory, expected_database):
        if self.override:
            raise LocationError('显式指定 --database 时不能修改默认存储位置')
        target = absolute_path(directory)/'live.sqlite3'
        with self.lock():
            self.recover()
            source = self.current()
            if self.settings.exists() and not source.is_file():
                raise LocationError('已配置的数据库不可用，请连接存储设备；未创建空库替代')
            if source != target:
                if source != absolute_path(expected_database):
                    raise LocationError('存储位置已被其他操作修改，请刷新状态后重试')
                if target.exists():
                    raise LocationError('目标数据库已存在，未覆盖；请使用其他空文件夹')
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                store = DataStore(source)
                store.close()
                save_json(self.journal, {'source': str(source), 'target': str(target),
                                        'stage': str(target.parent/f'.douyin-migration-{uuid.uuid4().hex}.sqlite3')})
                self.recover()
            store = DataStore(target)
            try:
                return store.status()
            finally:
                store.close()
