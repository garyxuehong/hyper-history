let { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

let reactHistoryNav;

let currTerminal;

let currPid = '';
let currUserInputData = '';
let currCwd = '/';
let historyEntries = [];

exports.decorateConfig = (config) => {
    return Object.assign({}, config, {
        css: `
            ${config.css || ''}
            .hyper-history {
                position: fixed;
                top: 0px;
                bottom: 0px;
                right: 0px;
                width: 30%;
                min-width: 200px;
                max-width: 400px;
                pointer-events: none;
            }
            .hyper-history-list {
                pointer-events: initial;
            }
            .hyper-history-list__item {
                padding: 4px;
                cursor: pointer;
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
                border: 1px solid currentColor;
            }
            .hyper-history-list__item:hover .hyper-history-list__item:after {
                opacity: 0.4;
            }
            .hyper-history-list__item:active .hyper-history-list__item:after {
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
        handleClick(e) {}
        render() {
            return (
                React.createElement(Hyper, Object.assign({}, this.props, {
                    customChildren: React.createElement('div', { className: 'hyper-history' },
                        React.createElement('div', { className: 'hyper-history-list' },
                            ...historyEntries.map(entry => {
                                return React.createElement('div', {
                                    className: 'hyper-history-list__item',
                                    onClick: _ => {
                                        activeItem(entry);
                                    }
                                }, entry.command);
                            })
                        )
                    )
                }))
            )
        }
    };
};

exports.middleware = (store) => (next) => (action) => {
    const uids = store.getState().sessions.sessions;
    switch (action.type) {
        case 'SESSION_USER_DATA':
            const { data } = action;
            if (data.charCodeAt(0) === 13) {
                reset();
            } else if (data.charCodeAt(0) === 127) {
                currUserInputData = currUserInputData ? currUserInputData.slice(0, -1) : '';
                currUserInputData.length === 0 ? reset() : grepHistory();
            } else {
                currUserInputData += (data ? data : '').toLowerCase();
                currUserInputData.length === 0 ? reset() : grepHistory();
            }
            break;
        case 'SESSION_SET_ACTIVE':
            currPid = uids[action.uid].pid;
            setCwd(currPid);
            break;
    }
    next(action);
};

exports.decorateTerm = (Term, { React, notify }) => {

    return class extends React.Component {

        constructor(props, context) {
            super(props, context);
            this._onTerminal = this._onTerminal.bind(this);
        }

        _onTerminal(term) {
            if (this.props && this.props.onTerminal) this.props.onTerminal(term);
            window.HYPER_HISTORY_TERM = currTerminal = term;
            const handler = [
                "keydown",
                function(e) {
                    if (e.metaKey && e.keyCode === 220) {
                        e.preventDefault();
                        onepass.password("sudolikeaboss://local")
                            .then(pass => this.terminal.io.sendString(pass))
                            .catch(() => {});
                    }
                }.bind(term.keyboard)
            ];

            term.uninstallKeyboard();
            term.keyboard.handlers_ = [handler].concat(term.keyboard.handlers_);
            term.installKeyboard();
        }

        render() {
            return React.createElement(Term, Object.assign({}, this.props, {
                onTerminal: this._onTerminal
            }));
        }

    };
};

function reset() {
    currUserInputData = '';
    historyEntries = [];
    updateReact();
}

function grepHistory() {
    fs.readFile(path.join(process.env['HOME'], '.bash_history'), (err, data) => {
        if (!err) {
            let history = data.toString();
            let set = {};
            historyEntries = !history ? [] : history.split('\n')
                .map(e => {
                    if (e.length <= 2) {
                        return undefined;
                    } else if (set[e] === true) {
                        return undefined;
                    } else {
                        set[e] = true;
                        return e.toLowerCase();
                    }
                })
                .filter(e => !!e && e.indexOf(currUserInputData) != -1)
                .map(e => {
                    return {
                        command: e
                    }
                });
            updateReact();
        } else {
            console.error(err);
        }
    });
}

function updateReact() {
    reactHistoryNav.forceUpdate();
}

// Current shell cwd
function setCwd(pid) {
    exec(`lsof -p ${pid} | grep cwd | tr -s ' ' | cut -d ' ' -f9-`, (err, cwd) => {
        currCwd = cwd.trim();
    })
};

function activeItem(entry) {
    let command = entry.command;
    currTerminal.io.sendString('\b'.repeat(currUserInputData.length));
    currTerminal.io.sendString(command);
    currTerminal.io.sendString('\n');
    currUserInputData = command;
    historyEntries = [];
    updateReact();
    console.log('to active command', command);
}
