'use strict';
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const contentDisposition = require('content-disposition');
const archiveType = require('archive-type');
const decompress = require('@bracketed/decompress');
const filenamify = require('filenamify');
const getStream = require('get-stream');
const got = require('got');
const makeDir = require('make-dir');
const pify = require('pify');
const pEvent = require('p-event');
const fileType = require('file-type');
const extName = require('ext-name');

const fsP = pify(fs);
const filenameFromPath = async (res) => path.basename(new URL(await res.requestUrl).pathname);

const getExtFromMime = async (res) => {
	const header = await res.headers['content-type'];

	if (!header) {
		return null;
	}

	const exts = extName.mime(header);

	if (exts.length !== 1) {
		return null;
	}

	return exts[0].ext;
};

const getFilename = async (res, data) => {
	const header = await res.headers['content-disposition'];

	if (header) {
		const parsed = contentDisposition.parse(header);

		if (parsed.parameters && parsed.parameters.filename) {
			return parsed.parameters.filename;
		}
	}

	let filename = await filenameFromPath(res);

	if (!path.extname(filename)) {
		const ext = ((await fileType(data)) || {}).ext || (await getExtFromMime(res));

		if (ext) {
			filename = `${filename}.${await ext}`;
		}
	}

	return filename;
};

module.exports = async (uri, output, opts) => {
	if (typeof (await output) === 'object') {
		opts = await output;
		output = null;
	}

	opts = await Object.assign(
		{
			encoding: null,
			rejectUnauthorized: process.env.npm_config_strict_ssl !== 'false',
		},
		opts
	);

	const stream = got.stream(uri, opts);

	const promise = await pEvent(stream, 'response')
		.then(async (res) => {
			const encoding = (await opts.encoding) === null ? 'buffer' : await opts.encoding;
			return await Promise.all([await getStream(stream, { encoding }), res]);
		})
		.then(async (result) => {
			const [data, res] = await result;

			if (!output) {
				return (await opts.extract) && (await archiveType(await data))
					? await decompress(await data, await opts)
					: await data;
			}

			const filename = (await opts.filename) || (await filenamify(await getFilename(res, data)));
			const outputFilepath = path.join(output, filename);

			if (opts.extract && (await archiveType(data))) {
				return await decompress(data, path.dirname(outputFilepath), opts);
			}

			return await makeDir(path.dirname(outputFilepath))
				.then(async () => await fsP.writeFile(outputFilepath, await data))
				.then(async () => await data);
		});

	stream.then = await promise.then.bind(await promise);
	stream.catch = await promise.catch.bind(await promise);

	return stream;
};

