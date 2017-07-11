import { Import } from './import';
import { Pojo, CSSObject } from './types';
import {
    createSimpleSelectorChecker,
    hasOwn,
    objectifyCSS,
    parseSelector,
    PseudoSelectorAstNode,
    SBTypesParsers,
    traverseNode,
} from './parser';
import { Resolver } from './resolver';

const kebab = require("kebab-case");

export interface TypedClass {
    "-sb-root"?: boolean;
    "-sb-states"?: string[];
    "-sb-type"?: string;
}

export interface Mixin {
    type: string;
    options: Pojo;
}

export class Stylesheet {
    cssDefinition: CSSObject;
    namespace: string;
    classes: Pojo<string>;
    typedClasses: Pojo<TypedClass>;
    mixinSelectors: Pojo<Mixin[]>;
    resolvedSymbols: Pojo<any>;
    vars: Pojo<string>;
    imports: Import[];
    root: string;
    source: string;
    _kind = "Stylesheet";
    constructor(cssDefinition: CSSObject, namespace: string = "", source: string = "") {
        this.source = source;
        this.cssDefinition = cssDefinition;
        this.root = 'root';
        this.classes = { root: this.root };
        this.typedClasses = { root: { "-sb-root": true } };
        this.vars = {};
        this.mixinSelectors = {};
        this.imports = [];
        this.namespace = this.getNamespace(namespace);
        this.process();
    }
    static fromCSS(css: string, namespace?: string, source?: string) {
        return new this(objectifyCSS(css), namespace, source);
    }
    static isStylesheet(maybeStylesheet: any) {
        return maybeStylesheet instanceof Stylesheet;
    }
    private getNamespace(strongNamespace = "") {
        if (strongNamespace) { return strongNamespace.replace(/'|"/g, ''); }
        const value = this.cssDefinition["@namespace"];
        if (Array.isArray(value)) {
            return value[value.length - 1].replace(/'|"/g, '');
        } else if (value) {
            return value.replace(/'|"/g, '');
        } else {
            //TODO: maybe auto generate here.
            return '';
        }
    }
    /******** can be moved to own class *********/
    private process() {
        
        Object.keys(this.cssDefinition).forEach((selector: string) => {
            const ast = parseSelector(selector);
            const checker = createSimpleSelectorChecker();
            let isSimpleSelector = true;
            this.addMixins(selector);
            traverseNode(ast, (node) => {
                if (!checker(node)) { isSimpleSelector = false; }
                const { type, name } = node;
                if (type === "pseudo-class") {
                    if (name === 'import') {
                        const { content } = <PseudoSelectorAstNode>node;
                        this.imports.push(Import.fromImportObject(content, this.cssDefinition[selector]));
                    } else if (name === 'vars') {
                        this.vars = this.cssDefinition[selector];
                    }
                } else if (type === 'class') {
                    this.classes[node.name] = node.name;
                } else if (type === 'nested-pseudo-class') {
                    if (name === 'global') {
                        return true;
                    }
                }
                return undefined;
            });
            this.addTypedClasses(selector, isSimpleSelector);
        });
    }
    private addTypedClasses(selector: string, isSimpleSelector: boolean) {
        this.addTypedClass(selector, isSimpleSelector, '-sb-root');
        this.addTypedClass(selector, isSimpleSelector, '-sb-states');
        this.addTypedClass(selector, isSimpleSelector, '-sb-type');
    }
    private addTypedClass(selector: string, isSimpleSelector: boolean, rule: keyof typeof SBTypesParsers) {
        const rules: Pojo<string> = this.cssDefinition[selector];
        if (hasOwn(rules, rule)) {
            if (!isSimpleSelector) {
                throw new Error(kebab(rule) + ' on complex selector: ' + selector);
            }
            const name = selector.replace('.', '');
            this.typedClasses[name] = {
                ...this.typedClasses[name],
                [rule]: SBTypesParsers[rule](rules[rule])
            };
            delete rules[rule];
        }
    }
    private addMixins(selector: string) {
        const rules: Pojo<string> = this.cssDefinition[selector];
        let mixin: string | string[] = rules["-sb-mixin"];
        if (mixin && !Array.isArray(mixin)) { mixin = [mixin]; }

        if (mixin) {
            const last = mixin[mixin.length - 1];
            this.mixinSelectors[selector] = SBTypesParsers["-sb-mixin"](last);
            delete rules["-sb-mixin"];
        }
    }
    /********************************************/

    getImportForSymbol(symbol: string) {
        return this.imports.filter((_import) => _import.containsSymbol(symbol))[0] || null;
    }
    resolveSymbols(resolver: Resolver) {
        //TODO: add support __esModule support?
        const imports = this.imports.reduce((acc, importDef) => {
            const m = resolver.resolveModule(importDef.from);
            acc[importDef.defaultExport || importDef.from] = m.default || m;
            const isStylesheet = Stylesheet.isStylesheet(m);
            for (const name in importDef.named) {
                acc[name] = isStylesheet ? m.vars[name] : m[name];
            }
            return acc;
        }, {} as Pojo);
        let symbols = { ...imports };
        Object.keys(this.vars).forEach(varName => {
            if (symbols[varName]) {
                throw Error(`resolveSymbols: Name ${varName} already set`);
            }
            symbols[varName] = this.vars[varName];
        });
        return symbols;
    }
    resolve(resolver: Resolver, name: string) {
        const typedClass = this.typedClasses[name];
        const _import = typedClass ? this.getImportForSymbol(typedClass['-sb-type'] || "") : null;
        return _import ? resolver.resolveModule(_import.from) : this;
    }
    public get(name: string) {
        return this.classes[name] || null;
    }
    public stateAttr(stateName: string) {
        return `data-${this.namespace.toLowerCase()}-${stateName.toLowerCase()}`;
    }
    public cssStates(stateMapping?: Pojo<boolean>) {
        return stateMapping ? Object.keys(stateMapping).reduce((states: Pojo<boolean>, key) => {
            if (stateMapping[key]) { states[this.stateAttr(key)] = true; }
            return states;
        }, {}) : {};
    }

}

