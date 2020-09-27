const nock = require('nock');
const path = require('path');
const fs = require('fs');
const mkdirp = require('mkdirp');
const zlib = require('zlib');
const sanitize = require('sanitize-filename');

/***
 * Initialization function. Adds useMock and recMock to it object.
 */
exports.init = function (allowNetConnect) {

    if (typeof(global.it) !== 'function' || global.it.length < 2) {
        throw Error('global.it is not valid.');
    }
    global.it.useMock = useMock;
    global.it.recMock = recMock;
   if(allowNetConnect) {
        autoMockConfig.allowNetConnect = allowNetConnect;
    }
};

let autoMockConfig = {
    allowNetConnect: /(127.0.0.1|localhost)/
}

function generateMockPath(test) {
    let title = sanitize(test.title);
    let directoryName = path.basename(test.file, path.extname(test.file));
    directoryName = directoryName.replace('.spec', '');
    let mockPath = path.resolve(
        path.join('test/mocks/' + directoryName, title + '.json')
    );
    if (mockPath.lengh > 259)
        throw Error('Path to file is longer than 260 characters');
    return mockPath;
}

/**
 * Wrapps the original it function but instead of supplying it with the test,
 * supply a function that loads or starts recording of mocks and then proceed to run the actual test.
 * Do not change this funcion to have more than 2 parameters. Using more than two parameters
 * will make IDEs such as webstorm fail to recognice the IT statement as a test.
 * @param title name of the test
 * @param testCodeFn reference to the function containing the test
 */
function useMock(title, testCodeFn) {

    global.it(title, function (done) {
        let test = this.test;

        let mockPath = generateMockPath(test);
        loadMockFile(mockPath);
        testCodeFn.call(this, function (result) {
            test.callback(result);
        });
    });
}

function recMock(title, testCodeFn) {

    global.it(title, function (done) {
        let test = this.test;

        let mockPath = generateMockPath(test);
        if (fs.existsSync(mockPath)) {
            throw Error(`A recorded mock for this test already exist at path "${mockPath}". If you intend to record a new mock for this test, delete the old file to record a new one. Remember to change recMock to useMock once you have recorded your mock to stop recording and start using it.`);
        }
        recordMock();
        testCodeFn.call(this, function (result) {
            writeRecordedMock(mockPath).then( () => {
                test.callback(result);
            });


        });
    });
}

/***
 * Reset nock to original state and clears all loded mocks. If a mock exist with the name off the test,
 * that mock will be loaded. If not nock recording will be enabled.
 * @param mockPath Path to directory and file where mocks are saved.
 */
function loadMockFile(mockPath) {
    if (fs.existsSync(mockPath)) {
        nock.cleanAll();
        nock.recorder.clear();
        nock.restore();
        nock.activate();

        nock.disableNetConnect();
        nock.enableNetConnect(autoMockConfig.allowNetConnect);
        nock.load(mockPath);
    }
    else {
        throw new Error(`No mock exist at ${mockPath}. If you intended to use record a new mock, change useMock to recMock.`);
    }
}

function recordMock() {
    nock.cleanAll();
    nock.recorder.clear();
    nock.restore();
    nock.activate();

    nock.recorder.rec({
        output_objects: true,
        dont_print: true
    });
}

/***
 * Check if any mock data has been recorded. If it has, write to a file with the same name as the test.
 * @param mockPath
 * @returns {*}
 */
function writeRecordedMock(mockPath) {
    return new Promise(function(resolve, reject) {
        let mocks = nock.recorder.play();

        if (mocks.length) {
            mocks = removeLocalScope(mocks);
            mocks = decodeGZIP(mocks);
            return mkdirp(path.dirname(mockPath), function () {
                console.log('Writing mock to file: ' + mockPath);
                fs.writeFileSync(mockPath, JSON.stringify(mocks, null, 2));
                return resolve(true);

            });
        }
        else {
            console.log('No mock data recorded for: ' + mockPath);
            return resolve(false);
        }
    });
}

/***
 * remove requests to localhost and 127.0.01 from mock list.
 * @param mocks array with mock data to filter.
 * @returns {Array} the modified array of mock data.
 */
function removeLocalScope(mocks) {
    let filtered = [];
    for (let mock of mocks) {
        if (mock.scope.indexOf('localhost') === -1 && mock.scope.indexOf('127.0.0.1') === -1) {
            filtered.push(mock);
        }
    }
    return filtered;
}

/***
 * Some requests returns gzip compressed data. This function will decode it into readable text.
 * @param mocks array with mock data to search for gzip encoded data.
 * @returns {*}
 */
function decodeGZIP(mocks) {
    let i = mocks.length;
    while (i--) {
        let gzipIndex = -1;
        if ((gzipIndex = mocks[i].rawHeaders.indexOf('gzip')) === -1) {
            continue;
        }

        let mergedResponse = mocks[i].response.join('');
        const response = new Buffer(mergedResponse, 'hex');

        const contents = zlib.gunzipSync(response).toString('utf8');

        mocks[i].response = JSON.parse(contents);
        mocks[i].rawHeaders.splice(gzipIndex - 1, 2);
    }
    return mocks;
}
