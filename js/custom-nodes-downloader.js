import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js"
import { ComfyDialog, $el } from "../../scripts/ui.js";
import { install_checked_custom_node, manager_instance } from  "./common.js";

async function getCustomNodes() {
	var mode = "url";
	if(manager_instance.local_mode_checkbox.checked)
		mode = "local";

	var skip_update = "";
	if(manager_instance.update_check_checkbox.checked)
		skip_update = "&skip_update=true";

	const response = await api.fetchApi(`/customnode/getlist?mode=${mode}${skip_update}`);

	const data = await response.json();
	return data;
}

async function getCustomnodeMappings() {
	var mode = "url";
	if(manager_instance.local_mode_checkbox.checked)
		mode = "local";

	const response = await api.fetchApi(`/customnode/getmappings?mode=${mode}`);

	const data = await response.json();
	return data;
}

async function getUnresolvedNodesInComponent() {
	try {
		var mode = "url";
		if(manager_instance.local_mode_checkbox.checked)
			mode = "local";

		const response = await api.fetchApi(`/component/get_unresolved`);

		const data = await response.json();
		return data.nodes;
	}
	catch {
		return [];
	}
}

export class CustomNodesInstaller extends ComfyDialog {
	static instance = null;

	install_buttons = [];
	message_box = null;
	data = null;

	clear() {
		this.install_buttons = [];
		this.message_box = null;
		this.data = null;
	}

	constructor() {
		super();
		this.search_keyword = '';
		this.element = $el("div.comfy-modal", { parent: document.body }, []);
	}

	startInstall(target) {
		const self = CustomNodesInstaller.instance;

		self.updateMessage(`<BR><font color="green">Installing '${target.title}'</font>`);
	}

	disableButtons() {
		for(let i in this.install_buttons) {
			this.install_buttons[i].disabled = true;
			this.install_buttons[i].style.backgroundColor = 'gray';
		}
	}

	apply_searchbox(data) {
		let keyword = this.search_box.value.toLowerCase();
		for(let i in this.grid_rows) {
			let data = this.grid_rows[i].data;
			let content = data.author.toLowerCase() + data.description.toLowerCase() + data.title.toLowerCase();

			if(this.filter && this.filter != '*') {
				if(this.filter != data.installed) {
					this.grid_rows[i].control.style.display = 'none';
					continue;
				}
			}

			if(keyword == "")
				this.grid_rows[i].control.style.display = null;
			else if(content.includes(keyword)) {
				this.grid_rows[i].control.style.display = null;
			}
			else {
				this.grid_rows[i].control.style.display = 'none';
			}
		}
	}

	async filter_missing_node(data) {
		const mappings = await getCustomnodeMappings();


		// build regex->url map
		const regex_to_url = [];
		for (let i in data) {
			if(data[i]['nodename_pattern']) {
				let item = {regex: new RegExp(data[i].nodename_pattern), url: data[i].files[0]};
				regex_to_url.push(item);
			}
		}

		// build name->url map
		const name_to_url = {};
		for (const url in mappings) {
			const names = mappings[url];
			for(const name in names[0]) {
				name_to_url[names[0][name]] = url;
			}
		}

		const registered_nodes = new Set();
		for (let i in LiteGraph.registered_node_types) {
			registered_nodes.add(LiteGraph.registered_node_types[i].type);
		}

		const missing_nodes = new Set();
		const nodes = app.graph.serialize().nodes;
		for (let i in nodes) {
			const node_type = nodes[i].type;
			if (!registered_nodes.has(node_type)) {
				const url = name_to_url[node_type.trim()];
				if(url)
					missing_nodes.add(url);
				else {
					for(let j in regex_to_url) {
						if(regex_to_url[j].regex.test(node_type)) {
							missing_nodes.add(regex_to_url[j].url);
						}
					}
				}
			}
		}

		let unresolved_nodes = await getUnresolvedNodesInComponent();
		for (let i in unresolved_nodes) {
			let node_type = unresolved_nodes[i];
			const url = name_to_url[node_type];
			if(url)
				missing_nodes.add(url);
		}

		return data.filter(node => node.files.some(file => missing_nodes.has(file)));
	}

	async invalidateControl() {
		this.clear();

		// splash
		while (this.element.children.length) {
			this.element.removeChild(this.element.children[0]);
		}

		const msg = $el('div', {id:'custom-message'},
			[$el('br'),
			'The custom node DB is currently being updated, and updates to custom nodes are being checked for.',
			$el('br'),
			'NOTE: Update only checks for extensions that have been fetched.',
			$el('br')]);
		msg.style.height = '100px';
		msg.style.verticalAlign = 'middle';
		msg.style.color = "var(--fg-color)";

		this.element.appendChild(msg);

		// invalidate
		this.data = (await getCustomNodes()).custom_nodes;

		if(this.is_missing_node_mode)
			this.data = await this.filter_missing_node(this.data);

		this.element.removeChild(msg);

		while (this.element.children.length) {
			this.element.removeChild(this.element.children[0]);
		}

		this.createHeaderControls();
		await this.createGrid();
		this.apply_searchbox(this.data);
		this.createBottomControls();
	}

	updateMessage(msg) {
		this.message_box.innerHTML = msg;
	}

    invalidate_checks(is_checked, install_state) {
        if(is_checked) {
            for(let i in this.grid_rows) {
                let data = this.grid_rows[i].data;
                let checkbox = this.grid_rows[i].checkbox;
                let buttons = this.grid_rows[i].buttons;

                checkbox.disabled = data.installed != install_state;

                if(checkbox.disabled) {
                    for(let j in buttons) {
                        buttons[j].style.display = 'none';
                    }
                }
                else {
                    for(let j in buttons) {
                        buttons[j].style.display = null;
                    }
                }
            }

            this.checkbox_all.disabled = false;
        }
        else {
            for(let i in this.grid_rows) {
                let checkbox = this.grid_rows[i].checkbox;
                if(checkbox.check)
                    return; // do nothing
            }

            // every checkbox is unchecked -> enable all checkbox
            for(let i in this.grid_rows) {
                let checkbox = this.grid_rows[i].checkbox;
                let buttons = this.grid_rows[i].buttons;
                checkbox.disabled = false;

                for(let j in buttons) {
                    buttons[j].style.display = null;
                }
            }

            this.checkbox_all.checked = false;
            this.checkbox_all.disabled = true;
        }
    }

    check_all(is_checked) {
        if(is_checked) {
            // lookup first checked item's state
            let check_state = null;
            for(let i in this.grid_rows) {
                let checkbox = this.grid_rows[i].checkbox;
                if(checkbox.checked) {
                    check_state = this.grid_rows[i].data.installed;
                }
            }

            if(check_state == null)
                return;

            // check only same state items
            for(let i in this.grid_rows) {
                let checkbox = this.grid_rows[i].checkbox;
                if(this.grid_rows[i].data.installed == check_state)
                    checkbox.checked = true;
            }
        }
        else {
            // uncheck all
            for(let i in this.grid_rows) {
                let checkbox = this.grid_rows[i].checkbox;
                let buttons = this.grid_rows[i].buttons;
                checkbox.checked = false;
                checkbox.disabled = false;

                for(let j in buttons) {
                    buttons[j].style.display = null;
                }
            }

            this.checkbox_all.disabled = true;
        }
    }

	async createGrid() {
		var grid = document.createElement('table');
		grid.setAttribute('id', 'custom-nodes-grid');

		this.grid_rows = {};

        let self = this;

        var thead = document.createElement('thead');
        var tbody = document.createElement('tbody');

		var headerRow = document.createElement('tr');
		thead.style.position = "sticky";
		thead.style.top = "0px";
        thead.style.borderCollapse = "collapse";
        thead.style.tableLayout = "fixed";

		var header0 = document.createElement('th');
		header0.style.width = "20px";
        this.checkbox_all = $el("input",{type:'checkbox', id:'check_all'},[]);
        header0.appendChild(this.checkbox_all);
        this.checkbox_all.checked = false;
        this.checkbox_all.disabled = true;
        this.checkbox_all.addEventListener('change', function() { self.check_all.call(self, self.checkbox_all.checked); });

		var header1 = document.createElement('th');
		header1.innerHTML = '&nbsp;&nbsp;ID&nbsp;&nbsp;';
		header1.style.width = "20px";
		var header2 = document.createElement('th');
		header2.innerHTML = 'Author';
		header2.style.width = "150px";
		var header3 = document.createElement('th');
		header3.innerHTML = 'Name';
		header3.style.width = "20%";
		var header4 = document.createElement('th');
		header4.innerHTML = 'Description';
		header4.style.width = "60%";
//        header4.classList.add('expandable-column');
		var header5 = document.createElement('th');
		header5.innerHTML = 'Install';
		header5.style.width = "130px";

		header0.style.position = "sticky";
		header0.style.top = "0px";
		header1.style.position = "sticky";
		header1.style.top = "0px";
		header2.style.position = "sticky";
		header2.style.top = "0px";
		header3.style.position = "sticky";
		header3.style.top = "0px";
		header4.style.position = "sticky";
		header4.style.top = "0px";
		header5.style.position = "sticky";
		header5.style.top = "0px";

        thead.appendChild(headerRow);
		headerRow.appendChild(header0);
		headerRow.appendChild(header1);
		headerRow.appendChild(header2);
		headerRow.appendChild(header3);
		headerRow.appendChild(header4);
		headerRow.appendChild(header5);

		headerRow.style.backgroundColor = "Black";
		headerRow.style.color = "White";
		headerRow.style.textAlign = "center";
		headerRow.style.width = "100%";
		headerRow.style.padding = "0";

		grid.appendChild(thead);
		grid.appendChild(tbody);

		if(this.data)
			for (var i = 0; i < this.data.length; i++) {
				const data = this.data[i];
				let dataRow = document.createElement('tr');

				let data0 = document.createElement('td');
		        let checkbox = $el("input",{type:'checkbox', id:`check_${i}`},[]);
		        data0.appendChild(checkbox);
		        checkbox.checked = false;
		        checkbox.addEventListener('change', function() { self.invalidate_checks.call(self, checkbox.checked, data.installed); });

				var data1 = document.createElement('td');
				data1.style.textAlign = "center";
				data1.innerHTML = i+1;
				var data2 = document.createElement('td');
		        data2.style.maxWidth = "100px";
				data2.className = "cm-node-author"
				data2.textContent = ` ${data.author}`;
				data2.style.whiteSpace = "nowrap";
                data2.style.overflow = "hidden";
				data2.style.textOverflow = "ellipsis";
                var data3 = document.createElement('td');
                data3.style.maxWidth = "200px";
                data3.style.wordWrap = "break-word";
				data3.className = "cm-node-name"
                data3.innerHTML = `&nbsp;<a href=${data.reference} target="_blank"><font color="skyblue"><b>${data.title}</b></font></a>`;
				var data4 = document.createElement('td');
				data4.innerHTML = data.description;
				data4.className = "cm-node-desc"
				var data5 = document.createElement('td');
				data5.style.textAlign = "center";

				var installBtn = document.createElement('button');
				installBtn.className = "cm-btn-install";
				var installBtn2 = null;
				var installBtn3 = null;

				this.install_buttons.push(installBtn);

				switch(data.installed) {
				case 'Disabled':
					installBtn3 = document.createElement('button');
					installBtn3.innerHTML = 'Enable';
					installBtn3.className = "cm-btn-enable";
					installBtn3.style.backgroundColor = 'blue';
					installBtn3.style.color = 'white';
					this.install_buttons.push(installBtn3);

					installBtn.innerHTML = 'Uninstall';
					installBtn.style.backgroundColor = 'red';
					break;
				case 'Update':
					installBtn2 = document.createElement('button');
					installBtn2.innerHTML = 'Update';
					installBtn2.className = "cm-btn-update";
					installBtn2.style.backgroundColor = 'blue';
					installBtn2.style.color = 'white';
					this.install_buttons.push(installBtn2);

					installBtn3 = document.createElement('button');
					installBtn3.innerHTML = 'Disable';
					installBtn3.className = "cm-btn-disable";
					installBtn3.style.backgroundColor = 'MediumSlateBlue';
					installBtn3.style.color = 'white';
					this.install_buttons.push(installBtn3);

					installBtn.innerHTML = 'Uninstall';
					installBtn.style.backgroundColor = 'red';
					break;
				case 'True':
					installBtn3 = document.createElement('button');
					installBtn3.innerHTML = 'Disable';
					installBtn3.className = "cm-btn-disable";
					installBtn3.style.backgroundColor = 'MediumSlateBlue';
					installBtn3.style.color = 'white';
					this.install_buttons.push(installBtn3);

					installBtn.innerHTML = 'Uninstall';
					installBtn.style.backgroundColor = 'red';
					break;
				case 'False':
					installBtn.innerHTML = 'Install';
					installBtn.style.backgroundColor = 'black';
					installBtn.style.color = 'white';
					break;
				default:
					installBtn.innerHTML = 'Try Install';
					installBtn.style.backgroundColor = 'Gray';
					installBtn.style.color = 'white';
				}

                let j = i;
				if(installBtn2 != null) {
					installBtn2.style.width = "120px";
					installBtn2.addEventListener('click', function() {
						install_checked_custom_node(self.grid_rows, j, CustomNodesInstaller.instance, 'update');
					});

					data5.appendChild(installBtn2);
				}

				if(installBtn3 != null) {
					installBtn3.style.width = "120px";
					installBtn3.addEventListener('click', function() {
						install_checked_custom_node(self.grid_rows, j, CustomNodesInstaller.instance, 'toggle_active');
					});

					data5.appendChild(installBtn3);
				}

				installBtn.style.width = "120px";
				installBtn.addEventListener('click', function() {
					if(this.innerHTML == 'Uninstall') {
						if (confirm(`Are you sure uninstall ${data.title}?`)) {
							install_checked_custom_node(self.grid_rows, j, CustomNodesInstaller.instance, 'uninstall');
						}
					}
					else {
						install_checked_custom_node(self.grid_rows, j, CustomNodesInstaller.instance, 'install');
					}
				});

				data5.appendChild(installBtn);

				dataRow.style.backgroundColor = "var(--bg-color)";
				dataRow.style.color = "var(--fg-color)";
				dataRow.style.textAlign = "left";

				dataRow.appendChild(data0);
				dataRow.appendChild(data1);
				dataRow.appendChild(data2);
				dataRow.appendChild(data3);
				dataRow.appendChild(data4);
				dataRow.appendChild(data5);
				tbody.appendChild(dataRow);

				let buttons = [];
				if(installBtn) {
				    buttons.push(installBtn);
                }
				if(installBtn2) {
				    buttons.push(installBtn2);
                }
				if(installBtn3) {
				    buttons.push(installBtn3);
                }

				this.grid_rows[i] = {data:data, buttons:buttons, checkbox:checkbox, control:dataRow};
			}

		const panel = document.createElement('div');
        panel.style.width = "100%";
		panel.appendChild(grid);

        function handleResize() {
          const parentHeight = self.element.clientHeight;
          const gridHeight = parentHeight - 200;

          grid.style.height = gridHeight + "px";
        }
		window.addEventListener("resize", handleResize);

		grid.style.position = "relative";
		grid.style.display = "inline-block";
		grid.style.width = "100%";
		grid.style.height = "100%";
		grid.style.overflowY = "scroll";
		this.element.style.height = "85%";
		this.element.style.width = "80%";
		this.element.appendChild(panel);

        handleResize();
	}

	createFilterCombo() {
		let combo = document.createElement("select");

		combo.style.cssFloat = "left";
		combo.style.fontSize = "14px";
		combo.style.padding = "4px";
		combo.style.background = "black";
		combo.style.marginLeft = "2px";
		combo.style.width = "199px";
		combo.id = `combo-manger-filter`;
		combo.style.borderRadius = "15px";

		let items =
			[
				{ value:'*', text:'Filter: all' },
				{ value:'Disabled', text:'Filter: disabled' },
				{ value:'Update', text:'Filter: update' },
				{ value:'True', text:'Filter: installed' },
				{ value:'False', text:'Filter: not-installed' },
			];

		items.forEach(item => {
			const option = document.createElement("option");
			option.value = item.value;
			option.text = item.text;
			combo.appendChild(option);
		});

		let self = this;
		combo.addEventListener('change', function(event) {
			self.filter = event.target.value;
			self.apply_searchbox();
		});

        if(self.filter) {
		    combo.value = self.filter;
		}

		return combo;
	}

	createHeaderControls() {
		let self = this;
		this.search_box = $el('input', {type:'text', id:'manager-customnode-search-box', placeholder:'input search keyword', value:this.search_keyword}, []);
		this.search_box.style.height = "25px";
		this.search_box.onkeydown = (event) => {
				if (event.key === 'Enter') {
					self.search_keyword = self.search_box.value;
					self.apply_searchbox();
				}
				if (event.key === 'Escape') {
					self.search_keyword = self.search_box.value;
					self.apply_searchbox();
				}
			};


		let search_button = document.createElement("button");
		search_button.innerHTML = "Search";
		search_button.onclick = () => {
			self.search_keyword = self.search_box.value;
			self.apply_searchbox();
		};
		search_button.style.display = "inline-block";

		let filter_control = this.createFilterCombo();
		filter_control.style.display = "inline-block";

		let cell = $el('td', {width:'100%'}, [filter_control, this.search_box, '  ', search_button]);
		let search_control = $el('table', {width:'100%'},
				[
					$el('tr', {}, [cell])
				]
			);

		cell.style.textAlign = "right";

		this.element.appendChild(search_control);
	}

	async createBottomControls() {
		let close_button = document.createElement("button");
		close_button.innerHTML = "Close";
		close_button.onclick = () => { this.close(); }
		close_button.style.display = "inline-block";

		this.message_box = $el('div', {id:'custom-installer-message'}, [$el('br'), '']);
		this.message_box.style.height = '60px';
		this.message_box.style.verticalAlign = 'middle';

		this.element.appendChild(this.message_box);
		this.element.appendChild(close_button);
	}

	async show(is_missing_node_mode) {
		this.is_missing_node_mode = is_missing_node_mode;
		try {
			this.invalidateControl();

			this.element.style.display = "block";
		}
		catch(exception) {
			app.ui.dialog.show(`Failed to get custom node list. / ${exception}`);
		}
	}
}