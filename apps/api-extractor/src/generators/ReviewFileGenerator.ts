// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as ts from 'typescript';

import { Collector } from '../collector/Collector';
import { TypeScriptHelpers } from '../analyzer/TypeScriptHelpers';
import { Span } from '../analyzer/Span';
import { CollectorEntity } from '../collector/CollectorEntity';
import { AstDeclaration } from '../analyzer/AstDeclaration';
import { StringBuilder } from '@microsoft/tsdoc';
import { SymbolAnalyzer } from '../analyzer/SymbolAnalyzer';
import { DeclarationMetadata } from '../collector/DeclarationMetadata';
import { SymbolMetadata } from '../collector/SymbolMetadata';
import { ReleaseTag } from '../aedoc/ReleaseTag';

export class ReviewFileGenerator {
  /**
   * Compares the contents of two API files that were created using ApiFileGenerator,
   * and returns true if they are equivalent.  Note that these files are not normally edited
   * by a human; the "equivalence" comparison here is intended to ignore spurious changes that
   * might be introduced by a tool, e.g. Git newline normalization or an editor that strips
   * whitespace when saving.
   */
  public static areEquivalentApiFileContents(actualFileContent: string, expectedFileContent: string): boolean {
    // NOTE: "\s" also matches "\r" and "\n"
    const normalizedActual: string = actualFileContent.replace(/[\s]+/g, ' ');
    const normalizedExpected: string = expectedFileContent.replace(/[\s]+/g, ' ');
    return normalizedActual === normalizedExpected;
  }

  public static generateReviewFileContent(collector: Collector): string {
    const output: StringBuilder = new StringBuilder();

    for (const entity of collector.entities) {
      if (entity.exported) {

        // Emit all the declarations for this entry
        for (const astDeclaration of entity.astSymbol.astDeclarations || []) {

          ReviewFileGenerator._writeAedocSynopsis(output, collector, astDeclaration);

          const span: Span = new Span(astDeclaration.declaration);
          ReviewFileGenerator._modifySpan(collector, span, entity, astDeclaration);
          output.append(span.getModifiedText());
          output.append('\n\n');
        }
      }
    }

    if (collector.package.tsdocComment === undefined) {
      output.append('\n');
      ReviewFileGenerator._writeLineAsComment(output, '(No @packageDocumentation comment for this package)');
    }

    return output.toString();
  }

  /**
   * Before writing out a declaration, _modifySpan() applies various fixups to make it nice.
   */
  private static _modifySpan(collector: Collector, span: Span, entity: CollectorEntity,
    astDeclaration: AstDeclaration): void {

    let recurseChildren: boolean = true;
    switch (span.kind) {
      case ts.SyntaxKind.JSDocComment:
        span.modification.skipAll();
        // For now, we don't transform JSDoc comment nodes at all
        recurseChildren = false;
        break;

      case ts.SyntaxKind.ExportKeyword:
      case ts.SyntaxKind.DefaultKeyword:
        span.modification.skipAll();
        break;

      case ts.SyntaxKind.Identifier:
        let nameFixup: boolean = false;
        const identifierSymbol: ts.Symbol | undefined = collector.typeChecker.getSymbolAtLocation(span.node);
        if (identifierSymbol) {
          const followedSymbol: ts.Symbol = TypeScriptHelpers.followAliases(identifierSymbol, collector.typeChecker);

          const referencedEntity: CollectorEntity | undefined = collector.tryGetEntityBySymbol(followedSymbol);

          if (referencedEntity) {
            if (!referencedEntity.nameForEmit) {
              // This should never happen
              throw new Error('referencedEntry.uniqueName is undefined');
            }

            span.modification.prefix = referencedEntity.nameForEmit;
            nameFixup = true;
            // For debugging:
            // span.modification.prefix += '/*R=FIX*/';
          }

        }

        if (!nameFixup) {
          // For debugging:
          // span.modification.prefix += '/*R=KEEP*/';
        }

        break;
    }

    if (recurseChildren) {
      for (const child of span.children) {
        let childAstDeclaration: AstDeclaration = astDeclaration;

        if (SymbolAnalyzer.isAstDeclaration(child.kind)) {
          childAstDeclaration = collector.astSymbolTable.getChildAstDeclarationByNode(child.node, astDeclaration);
        }

        ReviewFileGenerator._modifySpan(collector, child, entity, childAstDeclaration);
      }
    }
  }

  /**
   * Writes a synopsis of the AEDoc comments, which indicates the release tag,
   * whether the item has been documented, and any warnings that were detected
   * by the analysis.
   */
  private static _writeAedocSynopsis(output: StringBuilder, collector: Collector,
    astDeclaration: AstDeclaration): void {

    const declarationMetadata: DeclarationMetadata = collector.fetchMetadata(astDeclaration);
    const symbolMetadata: SymbolMetadata = collector.fetchMetadata(astDeclaration.astSymbol);

    const footerParts: string[] = [];

    switch (symbolMetadata.releaseTag) {
      case ReleaseTag.Internal:
        footerParts.push('@internal');
        break;
      case ReleaseTag.Alpha:
        footerParts.push('@alpha');
        break;
      case ReleaseTag.Beta:
        footerParts.push('@beta');
        break;
      case ReleaseTag.Public:
        footerParts.push('@public');
        break;
    }

    if (declarationMetadata.isSealed) {
      footerParts.push('@sealed');
    }

    if (declarationMetadata.isVirtual) {
      footerParts.push('@virtual');
    }

    if (declarationMetadata.isOverride) {
      footerParts.push('@override');
    }

    if (declarationMetadata.isEventProperty) {
      footerParts.push('@eventproperty');
    }

    if (declarationMetadata.tsdocComment) {
      if (declarationMetadata.tsdocComment.deprecatedBlock) {
        footerParts.push('@deprecated');
      }
    }

    if (declarationMetadata.needsDocumentation) {
      footerParts.push('(undocumented)');
    }

    if (footerParts.length > 0) {
      ReviewFileGenerator._writeLineAsComment(output, footerParts.join(' '));
    }
  }

  private static _writeLineAsComment(output: StringBuilder, line: string): void {
    output.append('// ');
    output.append(line);
    output.append('\n');
  }

}
