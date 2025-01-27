import { createFeature, FeatureContext } from './feature';
import { generalDiagnostics } from './diagnostics';
import * as STSymbol from './st-symbol';
import type { ImportSymbol } from './st-import';
import * as CSSClass from './css-class';
import type { StylableMeta } from '../stylable-meta';
import { isCompRoot, stringifySelector } from '../helpers/selector';
import { getOriginDefinition } from '../helpers/resolve';
import type { Type, ImmutableType, ImmutableSelectorNode } from '@tokey/css-selector-parser';
import type * as postcss from 'postcss';
import { createDiagnosticReporter } from '../diagnostics';

// ToDo: should probably consider removing StylableDirectives from this symbol
export interface ElementSymbol extends CSSClass.StPartDirectives {
    _kind: 'element';
    name: string;
    alias?: ImportSymbol;
}

export const diagnostics = {
    INVALID_FUNCTIONAL_SELECTOR: generalDiagnostics.INVALID_FUNCTIONAL_SELECTOR,
    UNSCOPED_TYPE_SELECTOR: createDiagnosticReporter(
        `03001`,
        'warning',
        (name: string) =>
            `unscoped type selector "${name}" will affect all elements of the same type in the document`
    ),
};

// HOOKS

export const hooks = createFeature<{
    SELECTOR: Type;
    IMMUTABLE_SELECTOR: ImmutableType;
}>({
    analyzeSelectorNode({ context, node, rule, walkContext: [_index, _nodes] }): void {
        if (node.nodes) {
            // error on functional type
            context.diagnostics.report(
                diagnostics.INVALID_FUNCTIONAL_SELECTOR(node.value, `type`),
                {
                    node: rule,
                    word: stringifySelector(node),
                }
            );
        }
        addType(context, node.value, rule);
    },
    transformSelectorNode({ context, node, selectorContext }): void {
        const resolvedSymbols = context.getResolvedSymbols(context.meta);
        const resolved = resolvedSymbols.element[node.value] || [
            // provides resolution for native elements
            // that are not collected by parts
            // or elements that are added by js mixin
            {
                _kind: 'css',
                meta: context.meta,
                symbol: { _kind: 'element', name: node.value },
            },
        ];
        selectorContext.setCurrentAnchor({ name: node.value, type: 'element', resolved });
        // native node does not resolve e.g. div
        if (resolved && resolved.length > 1) {
            const { symbol, meta } = getOriginDefinition(resolved);
            if (symbol._kind === 'class') {
                CSSClass.namespaceClass(meta, symbol, node, selectorContext.originMeta);
            } else {
                node.value = symbol.name;
            }
        }
    },
});

// API

export function get(meta: StylableMeta, name: string): ElementSymbol | undefined {
    return STSymbol.get(meta, name, `element`);
}

export function getAll(meta: StylableMeta): Record<string, ElementSymbol> {
    return STSymbol.getAllByType(meta, `element`);
}

export function addType(context: FeatureContext, name: string, rule?: postcss.Rule): ElementSymbol {
    const typeSymbol = STSymbol.get(context.meta, name, `element`);
    if (!typeSymbol && isCompRoot(name)) {
        let alias = STSymbol.get(context.meta, name);
        if (alias && alias._kind !== 'import') {
            alias = undefined;
        }
        STSymbol.addSymbol({
            context,
            symbol: {
                _kind: 'element',
                name,
                alias,
            },
            node: rule,
            safeRedeclare: !!alias,
        });
    }
    return STSymbol.get(context.meta, name, `element`)!;
}

export function validateTypeScoping({
    context,
    locallyScoped,
    reportUnscoped,
    node,
    nodes,
    index,
    rule,
}: {
    context: FeatureContext;
    locallyScoped: boolean;
    reportUnscoped: boolean;
    node: ImmutableType;
    nodes: ImmutableSelectorNode[];
    index: number;
    rule: postcss.Rule;
}): boolean {
    if (context.meta.type !== 'stylable') {
        // ignore in native CSS
        return true;
    }
    if (locallyScoped === false) {
        if (CSSClass.checkForScopedNodeAfter(context, rule, nodes, index) === false) {
            if (reportUnscoped) {
                context.diagnostics.report(diagnostics.UNSCOPED_TYPE_SELECTOR(node.value), {
                    node: rule,
                    word: node.value,
                });
            }
            return false;
        } else {
            locallyScoped = true;
        }
    }
    return locallyScoped;
}
