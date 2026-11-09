import React, { useMemo } from 'react';
import { ChevronRight, Folder, FolderOpen } from 'lucide-react';

const byName = new Intl.Collator('zh-CN', { numeric: true });

function folder(name, path) {
  return { name, path, children: new Map(), files: [], count: 0 };
}

function buildTree(documents, sourceFiles, candidates) {
  const root = folder('', '');
  const withoutPath = [];

  function add(path, entry) {
    let parent = root;
    for (const name of path.split('/').slice(0, -1)) {
      if (!parent.children.has(name)) {
        parent.children.set(name, folder(name, parent.path ? parent.path + '/' + name : name));
      }
      parent = parent.children.get(name);
      parent.count++;
    }
    parent.files.push(entry);
  }

  documents.forEach((doc, index) => {
    const path = sourceFiles.get(doc.id)?.path;
    const entry = { name: doc.title, doc, index };
    if (path) add(path, entry);
    else withoutPath.push(entry);
  });
  for (const file of candidates) add(file.path, { name: file.name, file });

  return { root, withoutPath };
}

export default function VaultFolderTree({ documents, sourceFiles, candidates, expandedPaths, setExpandedPaths, renderDocument, renderCandidate }) {
  const { root, withoutPath } = useMemo(() => buildTree(documents, sourceFiles, candidates), [documents, sourceFiles, candidates]);

  function toggle(path) {
    setExpandedPaths(previous => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function contents(parent, depth) {
    const children = [...parent.children.values()].sort((a, b) => byName.compare(a.name, b.name));
    return <>
      {children.map(child => {
        const open = expandedPaths.has(child.path);
        const Icon = open ? FolderOpen : Folder;
        return <div key={child.path} className="vault-branch">
          <button className="vault-folder-toggle" style={{ '--depth': Math.min(depth, 5) }}
            aria-label={`Obsidian 文件夹：${child.path}`} title={child.path}
            aria-expanded={open} onClick={() => toggle(child.path)}>
            <ChevronRight size={13} className="vault-chevron"/><Icon size={15}/>
            <span>{child.name}</span><small>{child.count}</small>
          </button>
          {open && <div role="group" aria-label={child.path}>{contents(child, depth + 1)}</div>}
        </div>;
      })}
      {parent.files.length > 0 && <div className="vault-folder-files" style={{ '--depth': Math.min(depth, 5) }}>
        {[...parent.files].sort((a, b) => byName.compare(a.name, b.name)).map(entry =>
          entry.doc ? renderDocument(entry.doc, entry.index) : renderCandidate(entry.file))}
      </div>}
    </>;
  }

  return <>
    {contents(root, 0)}
    {withoutPath.length > 0 && <>
      <p className="vault-inventory-notice">尚未取得目录的文献</p>
      {withoutPath.map(entry => renderDocument(entry.doc, entry.index))}
    </>}
  </>;
}
