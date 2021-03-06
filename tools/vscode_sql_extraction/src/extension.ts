import * as path from 'path';
import * as vscode from 'vscode';
import {SqlExtractionRunner} from './sql_extraction_runner';
import {Query, QueryFragment, locationToRange, toCombinedString} from './query';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  const isWindows = process.platform === 'win32';
  const execPath = path.join(
    __filename,
    '..',
    '..',
    'resources',
    'sql_extraction',
    'bin',
    isWindows ? 'sql_extraction.bat' : 'sql_extraction'
  );

  const provider = new SqlExtractionProvider(
    new SqlExtractionRunner(execPath),
    vscode.workspace.rootPath
  );
  vscode.window.createTreeView('vscode-sql-extraction.tree-view', {
    treeDataProvider: provider,
  });
  vscode.commands.registerCommand('vscode-sql-extraction.run', async () => {
    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Finding all queries',
        cancellable: true,
      },
      async (progress, token) => {
        return await provider.refresh(progress, token);
      }
    );
  });
  vscode.commands.registerCommand('vscode-sql-extraction.onclick', sqlQuery =>
    sqlQuery.onClick()
  );
}

// this method is called when your extension is deactivated
export function deactivate() {}

/**
 * Provides ordering in the tree panel.
 */
export class SqlExtractionProvider
  implements vscode.TreeDataProvider<SqlQueryItem> {
  private queries?: Query[];

  private _onDidChangeTreeData: vscode.EventEmitter<
    SqlQueryItem | undefined
  > = new vscode.EventEmitter<SqlQueryItem | undefined>();
  readonly onDidChangeTreeData: vscode.Event<SqlQueryItem | undefined> = this
    ._onDidChangeTreeData.event;

  constructor(
    private sqlExtractor: SqlExtractionRunner,
    private workspaceRoot?: string
  ) {}

  /**
   * Runs SQL Extraction to analyze all files.
   *
   * @param progress progress bar
   * @param token cancellation token
   */
  async refresh(
    progress: vscode.Progress<{
      message?: string | undefined;
      increment?: number | undefined;
    }>,
    token: vscode.CancellationToken
  ): Promise<void> {
    if (this.workspaceRoot) {
      if (
        vscode.workspace.textDocuments.filter(i => i.isDirty || i.isUntitled)
          .length > 0
      ) {
        vscode.window.showInformationMessage(
          'Unsaved changes found. These will not show up on analysis.'
        );
      }

      try {
        this.queries = await this.sqlExtractor.extractFromDirectory(
          this.workspaceRoot,
          progress,
          token
        );
      } catch (error) {
        return;
      }
    }

    this._onDidChangeTreeData.fire(undefined);

    // todo: next PR
    // const openEditor = vscode.window.activeTextEditor;
    // this.highlight(openEditor);
  }

  getTreeItem(element: SqlQueryItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SqlQueryItem): Thenable<SqlQueryItem[]> {
    if (!this.workspaceRoot) {
      vscode.window.showInformationMessage(
        'Cannot use SQL Extension in an empty workspace.'
      );
      return Promise.resolve([]);
    }

    if (!this.queries) {
      // Didn't run SQL Extraction yet
      return Promise.resolve([]);
    }

    if (!element) {
      // root elements
      return Promise.resolve(
        this.queries.map(query => {
          if (!query.query.treeItem) {
            query.query.treeItem = new SqlQueryItem(query, query.query);
          }
          return query.query.treeItem;
        })
      );
    }

    const parent = element.queryFragment;
    if (parent) {
      if (parent.literal) {
        return Promise.resolve([]);
      }

      return Promise.resolve(
        parent.complex!.map(query => {
          if (!query.treeItem) {
            query.treeItem = new SqlQueryItem(element.parentQuery, query);
          }
          return query.treeItem;
        })
      );
    }

    // todo: show usages
    return Promise.resolve([]);
  }
}

/**
 * Individual clickable item populating the tree view.
 * todo: show usages.
 */
export class SqlQueryItem extends vscode.TreeItem {
  constructor(
    public readonly parentQuery: Query,
    public readonly queryFragment?: QueryFragment
  ) {
    super(
      queryFragment
        ? toCombinedString(queryFragment).replace(/\s+/g, ' ')
        : 'Usage',
      queryFragment?.literal
        ? vscode.TreeItemCollapsibleState.None
        : vscode.TreeItemCollapsibleState.Collapsed
    );
    super.command = {
      command: 'vscode-sql-extraction.onclick',
      title: '',
      arguments: [this],
    };
  }

  get tooltip(): string {
    return this.parentQuery.confidence.toString() ?? '';
  }

  get description(): string {
    return this.parentQuery.file;
  }

  iconPath = {
    light: path.join(
      __filename,
      '..',
      '..',
      'resources',
      'light',
      'dependency.svg'
    ),
    dark: path.join(
      __filename,
      '..',
      '..',
      'resources',
      'dark',
      'dependency.svg'
    ),
  };

  contextValue = 'sqlquery';

  /**
   * Called when this item is clicked by the user.
   * Open and select the relevant file location.
   */
  onClick() {
    let range: vscode.Range | undefined = undefined;
    if (this.queryFragment) {
      range = locationToRange(this.queryFragment.location);
    }

    let filePath = this.parentQuery.file;
    if (!path.isAbsolute(filePath)) {
      filePath = path.join(vscode.workspace.rootPath!, this.parentQuery.file);
    }

    vscode.window.showTextDocument(vscode.Uri.file(filePath), {
      selection: range,
    });
  }
}
