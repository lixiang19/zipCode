(function () {
  const vscode = acquireVsCodeApi();
  const dropZone = document.querySelector('[data-js="drop-zone"]');
  const entriesList = document.querySelector('[data-js="entries"]');
  const packButton = document.querySelector('[data-js="pack"]');
  const clearButton = document.querySelector('[data-js="clear"]');
  const statusLine = document.querySelector('[data-js="status"]');
  let hideStatusHandle;

  if (!dropZone || !entriesList || !packButton || !clearButton || !statusLine) {
    return;
  }

  packButton.disabled = true;

  const initialState = vscode.getState();
  if (initialState?.entries) {
    renderEntries(initialState.entries);
  }

  dropZone.addEventListener('dragover', event => {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    dropZone.classList.add('drop-zone--hover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drop-zone--hover');
  });

  dropZone.addEventListener('drop', event => {
    event.preventDefault();
    dropZone.classList.remove('drop-zone--hover');
    const uriList = event.dataTransfer?.getData('text/uri-list') ?? '';
    const uris = uriList.split('\n').map(line => line.trim()).filter(Boolean);
    if (uris.length > 0) {
      vscode.postMessage({ type: 'add', uris });
    }
  });

  packButton.addEventListener('click', () => {
    vscode.postMessage({ type: 'pack' });
  });

  clearButton.addEventListener('click', () => {
    vscode.postMessage({ type: 'clear' });
  });

  entriesList.addEventListener('click', event => {
    const button = event.target instanceof HTMLElement && event.target.closest('button[data-key]');
    if (!button) {
      return;
    }
    const key = button.getAttribute('data-key');
    if (key) {
      vscode.postMessage({ type: 'remove', key });
    }
  });

  window.addEventListener('message', event => {
    const message = event.data;
    if (message?.type === 'entries') {
      renderEntries(message.entries ?? []);
      if (typeof message.status === 'string' && message.status) {
        setStatus(message.status);
      } else {
        clearStatus();
      }
    } else if (message?.type === 'status') {
      setStatus(message.text ?? '');
    }
  });

  function renderEntries(entries) {
    entriesList.textContent = '';
    for (const entry of entries) {
      const item = document.createElement('li');
      item.className = 'entry';
      const badge = document.createElement('span');
      badge.className = `entry__badge entry__badge--${entry.type}`;
      badge.textContent = entry.type === 'directory' ? 'Folder' : 'File';
      const label = document.createElement('span');
      label.className = 'entry__label';
      label.textContent = entry.relativePath;
      const remove = document.createElement('button');
      remove.className = 'entry__remove';
      remove.type = 'button';
      remove.setAttribute('data-key', entry.key);
      remove.title = 'Remove';
      remove.innerHTML = '×';
      item.append(badge, label, remove);
      entriesList.append(item);
    }
    const state = { entries };
    vscode.setState(state);
    packButton.disabled = entries.length === 0;
  }

  function setStatus(text) {
    clearTimeout(hideStatusHandle);
    statusLine.textContent = text;
    if (text) {
      hideStatusHandle = setTimeout(() => {
        statusLine.textContent = '';
      }, 4000);
    }
  }

  function clearStatus() {
    clearTimeout(hideStatusHandle);
    statusLine.textContent = '';
  }
})();
