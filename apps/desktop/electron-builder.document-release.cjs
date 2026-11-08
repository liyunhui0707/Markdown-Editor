'use strict';
// Opt-in Developer ID build. Local development packaging remains unchanged.
const base=require('./electron-builder.document.cjs');
const identity=process.env.DOCUMENT_SIGNING_IDENTITY||'';
if(!/^Developer ID Application: [^\r\n\0]+ \([A-Z0-9]{10}\)$/.test(identity))
 throw Error('Set DOCUMENT_SIGNING_IDENTITY to the full Developer ID Application certificate name; development/ad-hoc identities are not distribution identities.');
module.exports={...base,forceCodeSigning:true,directories:{output:'dist/signed'},mac:{...base.mac,
 // Builder 26 accepts the qualifier without the certificate-type prefix.
 identity:identity.slice('Developer ID Application: '.length),type:'distribution',
 hardenedRuntime:true,strictVerify:true,entitlements:'build/entitlements.mac.plist',
 entitlementsInherit:'build/entitlements.mac.plist',binaries:['Contents/Resources/document-save'],
 // Upload is a separate, explicit notarytool operation after the signed App is checked.
 notarize:false,
}};
