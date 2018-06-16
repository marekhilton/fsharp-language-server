/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as path from 'path';
import { window, workspace, ExtensionContext, Progress, commands, tasks, Task, TaskExecution, ShellExecution, Uri, TaskDefinition } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind, NotificationType } from 'vscode-languageclient';

export function activate(context: ExtensionContext) {

	// The server is packaged as a standalone command
	let serverMain = context.asAbsolutePath(binName());
	
	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	let serverOptions: ServerOptions = {
		run : { command: serverMain, args: [], transport: TransportKind.stdio },
		debug : { command: serverMain, args: [], transport: TransportKind.stdio }
	}
	
	// Options to control the language client
	let clientOptions: LanguageClientOptions = {
		// Register the server for F# documents
		documentSelector: [{scheme: 'file', language: 'fsharp'}],
		synchronize: {
			// Synchronize the setting section 'languageServerExample' to the server
			configurationSection: 'fsharp',
			// Notify the server about file changes to F# project files contain in the workspace
			// TODO: is there a way to configure this via the language server protocol?
			fileEvents: [
				workspace.createFileSystemWatcher('**/*.fsproj'),
				workspace.createFileSystemWatcher('**/*.fsx'),
				workspace.createFileSystemWatcher('**/project.assets.json')
			]
		}
	}
	
	// Create the language client and start the client.
	let client = new LanguageClient('fsharp', 'F# Language Server', serverOptions, clientOptions);
	let disposable = client.start();
	
	// Push the disposable to the context's subscriptions so that the 
	// client can be deactivated on extension deactivation
	context.subscriptions.push(disposable);

	// When the language client activates, register a progress-listener
	client.onReady().then(() => createProgressListeners(client));

	// Register test-runner
	commands.registerCommand('fsharp.command.test.run', runTest);
}

interface FSharpTestTask extends TaskDefinition {
	projectPath: string
	fullyQualifiedName: string
}

function runTest(projectPath: string, fullyQualifiedName: string): Thenable<TaskExecution> {
	let args = ['test', projectPath, '--filter', `FullyQualifiedName=${fullyQualifiedName}`]
	let kind: FSharpTestTask = {
		type: 'fsharp.task.test',
		projectPath: projectPath,
		fullyQualifiedName: fullyQualifiedName
	}
	let task = new Task(kind, workspace.getWorkspaceFolder(Uri.file(projectPath)), 'F# Test', 'F# Language Server', new ShellExecution('dotnet', args))
	return tasks.executeTask(task)
}

interface StartProgress {
	title: string 
	nFiles: number
}

function createProgressListeners(client: LanguageClient) {
	// Create a "checking files" progress indicator
	let progressListener = new class {
		countChecked = 0
		nFiles = 0
		progress: Progress<{message?: string}>
		resolve: (nothing: {}) => void
		
		startProgress(start: StartProgress) {
			// TODO implement user cancellation
			// TODO Change 15 to ProgressLocation.Notification
			window.withProgress({title: start.title, location: 15}, progress => new Promise((resolve, _reject) => {
				this.countChecked = 0;
				this.nFiles = start.nFiles;
				this.progress = progress;
				this.resolve = resolve;
			}));
		}

		private percentComplete() {
			return Math.floor(this.countChecked / (this.nFiles + 1) * 100);
		}

		incrementProgress(fileName: string) {
			if (this.progress != null) {
				let oldPercent = this.percentComplete();
				this.countChecked++;
				let newPercent = this.percentComplete();
				let report = {message: fileName, increment: newPercent - oldPercent};
				this.progress.report(report);
			}
		}

		endProgress() {
			this.countChecked = 0
			this.nFiles = 0
			this.progress = null
			this.resolve({})
		}
	}
	// Use custom notifications to drive progressListener
	client.onNotification(new NotificationType('fsharp/startProgress'), (start: StartProgress) => {
		progressListener.startProgress(start);
	});
	client.onNotification(new NotificationType('fsharp/incrementProgress'), (fileName: string) => {
		progressListener.incrementProgress(fileName);
	});
	client.onNotification(new NotificationType('fsharp/endProgress'), () => {
		progressListener.endProgress();
	});
}

function binName() {
	if (process.platform === 'win32')
		return path.join('src', 'FSharpLanguageServer', 'bin', 'Release', 'netcoreapp2.0', 'win10-x64', 'publish', 'FSharpLanguageServer.exe')
	else
		return path.join('src', 'FSharpLanguageServer', 'bin', 'Release', 'netcoreapp2.0', 'osx.10.11-x64', 'publish', 'FSharpLanguageServer')
}