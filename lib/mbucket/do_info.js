/*
 * Copyright 2019 Joyent, Inc.
 */

/*
 * `mbucket info ...`
 *
 * Get HEAD request info on buckets and bucket objects.
 */

var http = require('http');

var cmdln = require('cmdln');

var clicommon = require('./clicommon');
var MantaUri = require('../mantauri').MantaUri;


function do_info(subcmd, opts, args, cb) {
    var client = this.client;
    var muri;

    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length !== 1) {
        cb(new cmdln.UsageError('incorrect number of args'));
        return;
    }

    try {
        muri = new MantaUri(args[0]);
    } catch (parseErr) {
        cb(new cmdln.UsageError(parseErr, parseErr.message));
        return;
    }

    if (!muri.object) {
        client.headBucket(muri.bucket, function (err, res) {
            if (err) {
                cb(err);
            } else {
                clicommon.printBucketObjectInfo(res);
                cb();
            }
        });
    } else {
        client.headBucketObject(muri.bucket, muri.object, function (err, res) {
            if (err) {
                cb(err);
            } else {
                clicommon.printBucketObjectInfo(res);
                cb();
            }
        });
    }
}

do_info.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
];

do_info.help = [
    'Show HTTP headers for a bucket or bucket object.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'Examples:',
    '    # Bucket HTTP headers',
    '    mbucket info manta:mybucket',
    '',
    '    # Object HTTP headers',
    '    mbucket info manta:mybucket/foo.txt'
].join('\n');

do_info.synopses = ['{{name}} {{cmd}} [OPTIONS] [MANTA-URI]'];
do_info.completionArgtypes = ['mantabucketuri', 'none'];

module.exports = do_info;