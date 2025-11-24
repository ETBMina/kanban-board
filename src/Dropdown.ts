import { Menu } from 'obsidian';

export interface DropdownOption {
    label: string;
    value: string;
}

export class Dropdown {
    private container: HTMLElement;
    private options: DropdownOption[];
    private value: string;
    private onChange: (value: string) => void;
    private buttonEl: HTMLElement;
    private labelEl: HTMLElement;

    constructor(
        container: HTMLElement,
        options: string[] | DropdownOption[],
        initialValue: string,
        onChange: (value: string) => void,
        cls?: string
    ) {
        this.container = container;
        this.options = options.map(o => typeof o === 'string' ? { label: o, value: o } : o);
        this.value = initialValue;
        this.onChange = onChange;

        this.buttonEl = this.container.createDiv({ cls: 'kb-m3-dropdown ' + (cls || '') });
        this.labelEl = this.buttonEl.createSpan({ cls: 'kb-m3-dropdown-label' });
        this.updateLabel();

        const icon = this.buttonEl.createSpan({ cls: 'kb-m3-dropdown-icon' });
        // Material Design "arrow_drop_down" icon
        icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor"><path d="M480-360 280-560h400L480-360Z"/></svg>';

        this.buttonEl.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showMenu(e);
        };
    }

    private updateLabel() {
        const option = this.options.find(o => o.value === this.value);
        this.labelEl.setText(option ? option.label : this.value);
    }

    private showMenu(e: MouseEvent) {
        const menu = new Menu();

        // Add a class to the menu for custom styling if needed, though Obsidian handles menus globally
        // We can try to style the menu items to look more Material 3 if possible, but mostly we rely on the button look.

        for (const option of this.options) {
            menu.addItem((item) => {
                item.setTitle(option.label)
                    .setChecked(option.value === this.value)
                    .onClick(() => {
                        if (this.value !== option.value) {
                            this.value = option.value;
                            this.updateLabel();
                            this.onChange(this.value);
                        }
                    });
            });
        }

        // Position the menu relative to the button if possible, or mouse cursor
        // Obsidian's menu.showAtPosition uses screen coordinates.
        // We can try to align it with the button.
        const rect = this.buttonEl.getBoundingClientRect();
        menu.showAtPosition({ x: rect.left, y: rect.bottom });
    }

    public setValue(value: string) {
        this.value = value;
        this.updateLabel();
    }

    public getValue(): string {
        return this.value;
    }

    public setOptions(options: string[] | DropdownOption[]) {
        this.options = options.map(o => typeof o === 'string' ? { label: o, value: o } : o);
        this.updateLabel();
    }
}
