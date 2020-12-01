import { Compilation, Compiler, NormalModule } from 'webpack';
import { webpackCreateHash } from './types';
import {
    replaceCSSAssetPlaceholders,
    extractFilenameFromAssetModule,
    getAssetOutputPath,
    isLoadedWithKnownAssetLoader,
} from './plugin-utils';

const memorize = require('webpack/lib/util/memorize');

import { StylableWebpackPlugin } from './plugin';

const getCssModule = memorize(() => {
    return require('mini-css-extract-plugin/dist/CssModule').default;
});
export function injectCssModules(
    compilation: Compilation,
    staticPublicPath: string,
    createHash: webpackCreateHash,
    stylableModules: Set<NormalModule>,
    assetsModules: Map<string, NormalModule>
) {
    const CssModule = getCssModule();

    compilation.hooks.afterChunks.tap(StylableWebpackPlugin.name, () => {
        for (const module of stylableModules) {
            const cssModule = new CssModule({
                context: module.context,
                identifier: module.resource.replace('.st.css', '.css') + '?stylable-css-inject',
                identifierIndex: 1,
                content: replaceCSSAssetPlaceholders(
                    module.buildMeta.stylable,
                    staticPublicPath,
                    (resourcePath) => {
                        const assetModule = assetsModules.get(resourcePath);
                        if (!assetModule) {
                            throw new Error('Missing asset module for ' + resourcePath);
                        }
                        if (isLoadedWithKnownAssetLoader(assetModule)) {
                            return extractFilenameFromAssetModule(assetModule);
                        } else {
                            return getAssetOutputPath(
                                createHash,
                                assetModule,
                                compilation,
                                undefined,
                                undefined
                            );
                        }
                    }
                ),
                media: '',
                sourceMap: null,
            });
            cssModule.build(undefined, undefined, undefined, undefined, () => {
                /** We use the void build method just to ensure that the module have buildMeta and buildInfo */
            });

            compilation.modules.add(cssModule);

            for (const chunk of compilation.chunkGraph.getModuleChunksIterable(module)) {
                const [chunkGroup] = chunk.groupsIterable;
                compilation.chunkGraph.connectChunkAndModule(chunk, cssModule);
                chunkGroup.setModulePostOrderIndex(cssModule, module.buildMeta.stylable.depth);
            }
        }
    });
}

export function injectCSSOptimizationRules(compiler: Compiler) {
    const CssModule = getCssModule();
    if (!compiler.options.optimization) {
        compiler.options.optimization = {};
    }
    if (!compiler.options.optimization.splitChunks) {
        compiler.options.optimization.splitChunks = {};
    }
    if (!compiler.options.optimization.splitChunks.cacheGroups) {
        compiler.options.optimization.splitChunks.cacheGroups = {};
    }
    if (compiler.options.optimization.splitChunks.cacheGroups.stylable === undefined) {
        compiler.options.optimization.splitChunks.cacheGroups.stylable = {
            name: 'stylable',
            test: (module) => {
                return module.constructor.name === CssModule.name;
            },
            chunks: 'all',
            enforce: true,
        };
    }
}
