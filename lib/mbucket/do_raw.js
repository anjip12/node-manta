/*
 * Copyright 2019 Joyent, Inc.
 */

/*
 * `mbucket raw ...` hidden command for doing raw curl-like HTTP API calls
 * to Manta.
 *
 * TODOs:
 * - how to handle binary request: client vs jsonClient?
 * - given data with `-d` is not encoded as `curl` does. SHould we handle
 *   form encoding?
 * - consider adding an option like curl `--fail` to exit non-zero for an
 *   response >= 400 (see `resErr` below)
 */

var http = require('http');
var url = require('url');
var util = require('util');

var assert = require('assert-plus');
var cmdln = require('cmdln');
var vasync = require('vasync');
var VError = require('verror');


function do_raw(subcmd, opts, args, cb) {
    if (opts.help) {
        this.do_help('help', {}, [subcmd], cb);
        return;
    } else if (args.length < 1) {
        cb(new cmdln.UsageError('invalid arguments'));
        return;
    }

    var self = this;
    var client = self.client;

    var method = opts.method;
    if (!method) {
        if (opts.data) {
            method = 'PUT';
        } else {
            method = 'GET';
        }
    }
    var methodFunc = {
        GET: 'get',
        PUT: 'put',
        POST: 'post',
        HEAD: 'head',
        OPTIONS: 'opts',
        DELETE: 'del'
    }[method];
    if (!methodFunc) {
        cb(new VError('unknown HTTP method: "%s"', method));
        return;
    }

    // Get `reqOpts` from given options.
    var parsed = url.parse(args[0]);
    assert.ok(!parsed.host, 'given PATH should not have a host: ' + parsed.host);
    assert.ok(!parsed.port, 'given PATH should not have a port: ' + parsed.port);
    p = client.path(parsed.pathname);
    if (parsed.search) {
        p += parsed.search;
    }
    var reqOpts = {
        headers: {},
        path: p
    };
    if (opts.header) {
        for (var i = 0; i < opts.header.length; i++) {
            var raw = opts.header[i];
            var j = raw.indexOf(':');
            if (j < 0) {
                cb(new VError('failed to parse header: "%s"', raw));
                return;
            }
            var header = raw.substr(0, j);
            var value = raw.substr(j + 1).trimLeft();
            reqOpts.headers[header] = value;
        }
    }

    function writeResLine() {
        var line = util.format.apply(null, arguments);
        if (opts.verbose) {
            console.log('<', line);
        }
        if (opts.include || method === 'HEAD') {
            console.log(line);
        }
    }

    client.signRequest({
        headers: reqOpts.headers
    }, function onSignRequest(signErr) {
        if (signErr) {
            cb(signErr);
            return;
        }

        client.client[methodFunc](reqOpts, function onRequest(reqErr, req) {
            if (reqErr) {
                cb(reqErr);
                return;
            }

            if (opts.verbose) {
                console.log('> %s %s HTTP/1.1', method, reqOpts.path);
                Object.keys(reqOpts.headers).forEach(function (key) {
                    console.log('> %s: %s', key, reqOpts.headers[key]);
                });
                console.log('>');
            }

            req.on('result', function(resErr, res) {
                // `resErr` is set for HTTP statuses >= 400. We still want to
                // read and print the request.

                writeResLine('HTTP/%s %d %s',
                    res.httpVersion,
                    res.statusCode,
                    http.STATUS_CODES[res.statusCode]);
                Object.keys(res.headers).forEach(function (key) {
                    writeResLine('%s: %s', key, res.headers[key]);
                });
                writeResLine('');

                if (method === 'HEAD') {
                    cb();
                    return;
                }

                // I *think* that the current restify-clients HttpClient is
                // reading the response body when `resErr` is defined. Let's
                // use `resErr.body` if so.
                if (resErr) {
                    if (resErr.body) {
                        // Unfortunate even HttpClient will *parse* the body.
                        // At least that is what I observe. I haven't read
                        // the code to confirm.
                        if (typeof(resErr.body) === 'object') {
                            console.log(JSON.stringify(resErr.body));
                        } else {
                            process.stdout.write(resErr.body);
                        }
                    }
                    cb();
                    return;
                }

                // Chunks are Buffers (because we don't
                // `res.setEncoding('utf8')`. It is an assumption to attempt to
                // show them as String. Theoretically we could the
                // "content-type" response header, but at least Manta's "GET
                // /:login/buckets" doesn't set this currently.
                //
                // For now we'll assume it can be String-ified and rely on an
                // added CLI option to turn that off.
                res.on('data', function(chunk) {
                    process.stdout.write(chunk.toString('utf8'));
                });

                res.on('end', function() {
                    cb();
                });

            });

            if (opts.data) {
                if (opts.verbose) {
                    opts.data.split(/\n/g).forEach(function (line) {
                        console.log('>', line);
                    });
                }
                req.write(opts.data);
            }
            req.end();
        });
    });
}

do_raw.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['verbose', 'v'],
        type: 'bool',
        help: 'Curl-like verbose: show sent data and received headers.'
    },
    {
        names: ['method', 'X'],
        type: 'string',
        helpArg: 'METHOD',
        help: 'Request method to use. Default is "GET".'
    },
    {
        names: ['header', 'H'],
        type: 'arrayOfString',
        helpArg: 'HEADER',
        help: 'Headers to send with request.'
    },
    {
        names: ['include', 'i'],
        type: 'bool',
        help: 'Print response headers to stderr.'
    },
    {
        names: ['data', 'd'],
        type: 'string',
        helpArg: 'DATA',
        help: 'Add POST data. This must be valid JSON.'
    }
];

do_raw.synopses = [
    '{{name}} {{cmd}} [-X METHOD] [-H HEADER=VAL] [-d DATA] PATH'
];

do_raw.help = [
    'Raw Manta API request.',
    '',
    '{{usage}}',
    '',
    '{{options}}',
    'This attempts to be a raw curl-like command for calling the Manta API.',
    'Some notes/limitations:',
    '',
    '- When the response status is >=400 the restify-clients HttpClient is',
    '  reading and *parsing* the response body. Therefore you cannot trust',
    '  that the body printed by this command is exactly the bytes that Manta',
    '  sent.',
    '- This is not tested for writing/reading large or binary Manta objects.',
    '',
    'Examples:',
    '    {{name}} {{cmd}} ~~/buckets/mahbukkit -X PUT \\',
    '        -H "Content-Type: application/json; type=bucket"  # CreateBucket',
    '',
    '    {{name}} {{cmd}} ~~/buckets        # ListBuckets',
    '    {{name}} {{cmd}} ~~/buckets -i     # ... with response headers',
    '    {{name}} {{cmd}} ~~/buckets -v     # ... with req and res headers',
    '    {{name}} -v {{cmd}} ~~/buckets 2> >(bunyan)  # TRACE bunyan logging',
    '    {{name}} {{cmd}} ~~/buckets?limit=2'
].join('\n');

do_raw.hidden = true;


module.exports = do_raw;