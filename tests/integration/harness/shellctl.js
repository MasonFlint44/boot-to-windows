// gjs -m /opt/harness/shellctl.js <command> [args]
//   version                 ShellVersion property
//   eval <js>               org.gnome.Shell.Eval; prints the JSON result, exit 1 on failure
//   info <uuid>             GetExtensionInfo as JSON
//   state <uuid>            numeric state + name, e.g. "1 ACTIVE"
//   enable|disable <uuid>   EnableExtension / DisableExtension (prints true/false)
//   errors <uuid>           GetExtensionErrors, one per line
//   list                    ListExtensions: "<uuid> <state>" per line
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

// Values from js/misc/extensionUtils.js (ENABLED/DISABLED renamed ACTIVE/INACTIVE in 46).
const STATES = {1: 'ACTIVE', 2: 'INACTIVE', 3: 'ERROR', 4: 'OUT_OF_DATE', 5: 'DOWNLOADING',
    6: 'INITIALIZED', 7: 'DEACTIVATING', 8: 'ACTIVATING', 99: 'UNINSTALLED'};

const bus = Gio.DBus.session;
function call(dest, path, iface, method, params, replyType) {
    return bus.call_sync(dest, path, iface, method, params,
        replyType ? new GLib.VariantType(replyType) : null,
        Gio.DBusCallFlags.NONE, 30000, null);
}
const ext = (method, params, rt) => call('org.gnome.Shell.Extensions', '/org/gnome/Shell/Extensions',
    'org.gnome.Shell.Extensions', method, params, rt);

const [cmd, ...args] = System.programArgs;
let rc = 0;
try {
    switch (cmd) {
    case 'version': {
        const v = call('org.gnome.Shell', '/org/gnome/Shell', 'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', ['org.gnome.Shell', 'ShellVersion']), '(v)');
        print(v.recursiveUnpack()[0]);
        break;
    }
    case 'eval': {
        const [ok, out] = call('org.gnome.Shell', '/org/gnome/Shell', 'org.gnome.Shell', 'Eval',
            new GLib.Variant('(s)', [args.join(' ')]), '(bs)').deepUnpack();
        print(out);
        rc = ok ? 0 : 1;
        break;
    }
    case 'info': {
        const [info] = ext('GetExtensionInfo', new GLib.Variant('(s)', [args[0]]), '(a{sv})').recursiveUnpack();
        print(JSON.stringify(info));
        break;
    }
    case 'state': {
        const [info] = ext('GetExtensionInfo', new GLib.Variant('(s)', [args[0]]), '(a{sv})').recursiveUnpack();
        if (info.state === undefined) {
            print('0 NOT_FOUND');
        } else {
            print(`${info.state} ${STATES[info.state] ?? 'UNKNOWN'}`);
        }
        break;
    }
    case 'enable':
    case 'disable': {
        const m = cmd === 'enable' ? 'EnableExtension' : 'DisableExtension';
        const [ok] = ext(m, new GLib.Variant('(s)', [args[0]]), '(b)').deepUnpack();
        print(ok);
        rc = ok ? 0 : 1;
        break;
    }
    case 'errors': {
        const [errs] = ext('GetExtensionErrors', new GLib.Variant('(s)', [args[0]]), '(as)').deepUnpack();
        errs.forEach(e => print(e));
        break;
    }
    case 'list': {
        const [all] = ext('ListExtensions', null, '(a{sa{sv}})').recursiveUnpack();
        for (const [uuid, info] of Object.entries(all))
            print(`${uuid} ${info.state} ${STATES[info.state] ?? 'UNKNOWN'}`);
        break;
    }
    default:
        printerr(`unknown command: ${cmd}`);
        rc = 2;
    }
} catch (e) {
    printerr(`shellctl ${cmd}: ${e.message}`);
    rc = 3;
}
System.exit(rc);
