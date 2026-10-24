import Link from "next/link";

import { LEGAL_DOCUMENTS, LEGAL_OPERATOR, type LegalDocumentId } from "@/domain/legal";

/** /legal/* 三页共用；正文只在 domain/legal.ts 维护。 */
export function LegalDocumentPage({ id, backHref, backLabel }: { id: LegalDocumentId; backHref: string; backLabel: string }) {
  const document = LEGAL_DOCUMENTS[id];
  return (
    <main className="screen">
      <div className="page-heading">
        <Link className="back-link" href={backHref}>{backLabel}</Link>
        <span className="eyebrow">{LEGAL_OPERATOR.product}</span>
        <h1>{document.title}</h1>
        <p>更新日期：{document.updatedAt} ｜ 生效日期：{document.effectiveAt}</p>
      </div>
      {document.sections.map((section) => (
        <section className="panel" key={section.heading}>
          <h2>{section.heading}</h2>
          {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </section>
      ))}
    </main>
  );
}
