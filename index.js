let { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHAR_CODE_1 = 161;
const CHAR_CODE_2 = 8482;
const CHAR_CODE_3 = 163;

const QUICK_SELECT_CHAR_CODE = [CHAR_CODE_1, CHAR_CODE_2, CHAR_CODE_3];

let reactHistoryNav;

let allTerminals = {};
let currTerminal;

let currPid = '';
let actionUid = ''
let currUserInputData = '';
let currCwd = '/';
let historyEntries = [];

let supressMode = false;

let FullHistory = ''

const terms = {}
exports.terms = terms

let windowGlobal = null


const FullPathHistory = path.join(process.env['HOME'], '.bash_history')

exports.decorateConfig = (config) => {
    return Object.assign({}, config, {
        css: `
            ${config.css || ''}
            .hyper-history {
                position: fixed;
                top: 50px;
                bottom: 50px;
                right: 0px;
                width: 30%;
                min-width: 200px;
                max-width: 400px;
                pointer-events: none;
                overflow: scroll;
            }
            .hyper-history-list {
                pointer-events: initial;
                overflow: auto;
                width: 100%;
            }
            .hyper-history-list__item {
                padding: 4px;
                cursor: pointer;
                background-color: currentColor;
                position: relative;
            }
            .hyper-history-list__item:after {
                content: "";
                display: block;
                top: 0px;
                left: 0px;
                width: 100%;
                height: 100%;
                position: absolute;
                background-color: currentColor;
                opacity: 0;
                transition: opacity .1s ease;
            }
            .hyper-history-list__item:hover {
                padding: 3px;
                border: 0.01px solid currentColor;
                border-radius: 4px;
            }
            .hyper-history-list__item:hover.hyper-history-list__item:after {
                opacity: 0.4;
            }
            .hyper-history-list__item:active.hyper-history-list__item:after {
                opacity: 1;
            }
        `
    });
};

exports.decorateHyper = (Hyper, { React }) => {
    return class extends React.Component {
        constructor(props) {
            super(props);
            reactHistoryNav = this;
            this.state = {}
            this.handleClick = this.handleClick.bind(this);
        }
        handleClick(e) { }
        render() {
            return (
                React.createElement(Hyper, Object.assign({}, this.props, {

                    customChildren: React.createElement('div', { className: 'hyper-history' },
                        React.createElement('div', { className: 'hyper-history-list' },
                            ...historyEntries.map(entry => {
                                return React.createElement('div', {
                                    key: entry.index,
                                    className: 'hyper-history-list__item',
                                    onClick: _ => {
                                        activeItem(entry);
                                    }
                                }, `${entry.command}`);
                            })
                        )
                    )
                }))
            )
        }
    };
};

exports.middleware = (store) => (next) => (action) => {
    if (supressMode) {
        return next(action);
    }
    const uids = store.getState().sessions.sessions;
    console.log(uids, action)
    actionUid = action.uid
    switch (action.type) {
        case 'SESSION_SET_XTERM_TITLE':
            pid = uids[action.uid].pid;
            break;

        case 'SESSION_ADD':
            pid = action.pid;
            setCwd(pid);
            break;

        case 'SESSION_ADD_DATA':
            const { data: dataRaw } = action;
            const enterKey = dataRaw.indexOf('\n') > 0;

            if (enterKey) {
                setCwd(pid, action);
            }
            break;

        case 'SESSION_SET_ACTIVE':
            pid = uids[action.uid].pid;
            setCwd(pid);
            break;
        case 'SESSION_USER_DATA':
            const { data } = action;
            let charCode = data.charCodeAt(0);
            if (QUICK_SELECT_CHAR_CODE.includes(charCode)) {
                let idxQuickSel = QUICK_SELECT_CHAR_CODE.indexOf(charCode);
                if (idxQuickSel >= 0 && historyEntries.length > idxQuickSel) {
                    activeItem(historyEntries[idxQuickSel]);
                }
                reset();
                return; //prevent input
            } else if (data.charCodeAt(0) === 13) {
                reset();
            } else if (data.charCodeAt(0) === 127) {
                currUserInputData = currUserInputData ? currUserInputData.slice(0, -1) : '';
                currUserInputData.length === 0 ? reset() : grepHistory();
            } else {
                currUserInputData += (data ? data : '').toLowerCase();
                currUserInputData.length === 0 ? reset() : grepHistory();
            }
            
            break;       
    }
    next(action);
};

const PLUGIN = 'visual12312311';
const WRITE_TO_TERMINAL = `write to terminal`;

function waitFor(object, key, fn) {
	if (key in object) {
		fn(object[key]);
	} else {
		setTimeout(() => waitFor(object, key, fn), 10);
	}
}

exports.onWindow = (win) => {
    win.rpc.on(WRITE_TO_TERMINAL, ({ uid, command }) => {
     setTimeout(() => {
       win.sessions.forEach(session => {
         session.write('clear')
           session.write('\x0a');
            session.write(command);
            session.write('\x0a');
        })
    }, 1000)
    });
}

exports.decorateTerm = (Term, { React, notify }) => {
    return class extends React.Component {
        constructor(props, context) {
            super(props, context);
            this.onTerminal = this.onTerminal.bind(this, this);
        }
        onTerminal(self, term) {
            if (self.props.onTerminal) self.props.onTerminal(term);
            allTerminals[self.props.uid] = term;
            window.HYPER_HISTORY_TERM_ALL = allTerminals;
            window.HYPER_HISTORY_TERM = currTerminal = term;
        }
        render() {
            let props = Object.assign({}, this.props, {
                onTerminal: this.onTerminal
            });
            return React.createElement(Term, props);
        }
    };
};

function reset() {
    currUserInputData = '';
    historyEntries = [];
    updateReact();
}

let lastModifiedTime = 0
function readFullFile() {
    const statFile = fs.statSync(FullPathHistory)
    if (statFile.mtime !== lastModifiedTime) {
        lastModifiedTime = statFile.mtime
        FullHistory = fs.readFileSync(FullPathHistory).toString().split('\n')
        return FullHistory
    }

    return FullHistory
}

function grepHistory() {
    let history = readFullFile()
    let set = {};

    historyEntries = []

    const historySplited = history
    const lengthHistory = historySplited.length;

    for (let index = lengthHistory - 1; index >= 0; index--) {
        const element = historySplited[index];
        if (element.length <= 2 || set[element] === true) {
            continue;
        }
        set[element] = true;
        if (!!element && fuzzy_match(element, currUserInputData)) {
            historyEntries.push({
                index: historyEntries.length + 1,
                command: element
            });
        }
    }
    updateReact();
}

function updateReact() {
    reactHistoryNav.forceUpdate();
}

function setCwd(pid) {
    exec(`lsof -p ${pid} | grep cwd | tr -s ' ' | cut -d ' ' -f9-`, (err, cwd) => {
        currCwd = cwd.trim();
    })
};

function sendCommand(data) {
  return (dispatch) => {
    dispatch({ type: 'SEND_DATA_TERM', uid: actionUid, data: data, now: Date.now() });
  };
};

const writeToTerminal = (command, uid) => window.rpc.emit(WRITE_TO_TERMINAL, { command, uid });
const executeCommand = (command, uid, currentInput = '') =>
  writeToTerminal(`${'\b'.repeat(currentInput.length)}${command}\r`, uid);

function activeItem(entry) {
    supressMode = true;
    let command = entry.command;
    writeToTerminal(command, currPid)
   
    currUserInputData = '';
    historyEntries = [];
    supressMode = false;
}

function fuzzy_match(text, search) {
  search = search.replace(/\s+/g, '').toLowerCase();

  const tokens = new Array(text.length);

  let searchPosition = 0;

  for (let i = 0; i < text.length; i++) {
    const textChar = text[i];
    const isMatch =
      searchPosition < search.length &&
      textChar.toLowerCase() === search[searchPosition];

    if (isMatch) {
      tokens[i] = `<b>${textChar}</b>`;
      searchPosition++;
    } else {
      tokens[i] = textChar;
    }
  }

  return searchPosition === search.length ? tokens.join('') : '';
}
