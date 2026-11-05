"""Dedicated local native host / CLI. Python stdlib only; no socket listener."""
import argparse
import json
import os
import sys

from data_location import DataLocation, LocationError
from protocol import read_message, write_message


def handle(store, message):
    action = message.get('action')
    if action == 'append':
        return store.append(message.get('records'))
    if action == 'status':
        return store.status()
    if action == 'summary':
        return store.summary(message.get('room'))
    if action == 'predict':
        return store.predict(message.get('room'), message.get('anchor'), message.get('asOf'), message.get('rows'))
    if action == 'audience':
        return store.audience(message.get('room'), message.get('users'))
    raise ValueError('本地数据操作无效')


def native_loop(location):
    while True:
        try:
            message = read_message(sys.stdin.buffer)
            if message is None:
                return
        except (ValueError, UnicodeError):
            return
        try:
            if message.get('action') == 'relocate':
                value = location.relocate(message.get('directory'), message.get('expectedDatabase'))
            else:
                with location.open() as store:
                    value = handle(store, message)
            response = {'id': message.get('id'), 'value': value}
        except LocationError as error:
            response = {'id': message.get('id'), 'error': str(error)}
        except (ValueError, TypeError, KeyError):
            response = {'id': message.get('id'), 'error': '本地归档数据无效，未确认批次已保留'}
        except Exception:
            response = {'id': message.get('id'), 'error': '本地数据库写入失败，请检查磁盘空间和权限，未确认批次已保留'}
        write_message(response, sys.stdout.buffer)


def main():
    parser = argparse.ArgumentParser(description='本地直播数据仓库')
    parser.add_argument('--database')
    parser.add_argument('--settings')
    parser.add_argument('command', nargs='?', choices=['status', 'summary', 'export', 'dataset', 'pk-dataset', 'backup', 'train', 'audience', 'location'])
    parser.add_argument('--directory')
    parser.add_argument('--room')
    parser.add_argument('--anchor')
    parser.add_argument('--user', action='append', default=[])
    parser.add_argument('--target', choices=['diamonds', 'online'], default='diamonds')
    parser.add_argument('--horizon', type=int, default=5)
    parser.add_argument('--output')
    args = parser.parse_args()
    location = DataLocation(settings=args.settings, database=args.database)
    if args.command == 'location':
        with location.open() as store:
            current = str(store.path)
        print(json.dumps(location.relocate(args.directory, current), ensure_ascii=False))
        return
    if not args.command:
        native_loop(location)
        return
    with location.open() as store:
        if args.command in ('export', 'dataset', 'pk-dataset'):
            stream = open(args.output, 'x', encoding='utf-8') if args.output else sys.stdout
            try:
                if args.output:
                    os.chmod(args.output, 0o600)
                for row in getattr(store, args.command.replace('-', '_'))(args.room):
                    stream.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + '\n')
            finally:
                if args.output:
                    stream.close()
        elif args.command == 'backup':
            if not args.output:
                parser.error('backup 需要 --output')
            store.backup(args.output)
        elif args.command == 'train':
            if not args.room or not args.anchor:
                parser.error('train 需要 --room 和 --anchor')
            print(json.dumps(store.train(args.room, args.anchor, args.target, args.horizon), ensure_ascii=False))
        elif args.command == 'audience':
            print(json.dumps(store.audience(args.room, args.user), ensure_ascii=False))
        elif args.command:
            print(json.dumps(store.summary(args.room) if args.command == 'summary' else store.status(), ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except BrokenPipeError:
        pass
