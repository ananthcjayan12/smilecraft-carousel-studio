// Curated dental knowledge cards for V4.
// Facts are intentionally conservative: the writer may rephrase them, but may not add medical claims.
export const DENTAL_CONTENT_CARDS = Object.freeze([
  {
    id: 'sensitivity-001', topic: 'Tooth sensitivity', pillar: 'education', engagement: 92,
    services: ['general dentistry','restorative dentistry'],
    facts: [
      'Tooth sensitivity can happen when dentin becomes exposed or when tooth surfaces are irritated.',
      'Cold, hot, sweet or acidic foods can trigger sensitivity in some people.',
      'Persistent or worsening sensitivity can have several causes and should be assessed by a dental professional.'
    ],
    avoid: ['Do not say sensitivity always means a cavity.', 'Do not promise a permanent cure.'],
    angles: [
      ['cold-drink', 'Why does a cold drink suddenly hurt your teeth?'],
      ['ignore-it', 'When tooth sensitivity may deserve attention'],
      ['myth', 'Myth vs fact: sensitive teeth']
    ]
  },
  {
    id: 'bleeding-gums-001', topic: 'Bleeding gums', pillar: 'education', engagement: 96,
    services: ['general dentistry','periodontics','gum care'],
    facts: [
      'Gums that bleed during brushing or flossing can be a sign of inflammation.',
      'Plaque buildup near the gumline can contribute to gingivitis.',
      'Ongoing bleeding, swelling or tenderness should be discussed with a dental professional.'
    ],
    avoid: ['Do not diagnose gum disease from a social post.', 'Do not use fear-based claims.'],
    angles: [
      ['pink-sink', 'Seeing pink in the sink after brushing?'],
      ['normal', 'Is it normal for gums to bleed sometimes?'],
      ['mistakes', 'Common habits that can make irritated gums worse']
    ]
  },
  {
    id: 'brushing-001', topic: 'Brushing technique', pillar: 'prevention', engagement: 84,
    services: ['general dentistry','preventive dentistry'],
    facts: [
      'Brushing twice a day with fluoride toothpaste is widely recommended for oral hygiene.',
      'A soft-bristled toothbrush is suitable for most people.',
      'Aggressive brushing can irritate gums and contribute to wear at the gumline.'
    ],
    avoid: ['Do not imply harder brushing cleans better.'],
    angles: [
      ['too-hard', 'Are you brushing too hard?'],
      ['two-minutes', 'A better two-minute brushing routine'],
      ['mistakes', '3 brushing mistakes many people make']
    ]
  },
  {
    id: 'flossing-001', topic: 'Cleaning between teeth', pillar: 'prevention', engagement: 82,
    services: ['general dentistry','preventive dentistry'],
    facts: [
      'A toothbrush does not clean every surface between teeth.',
      'Cleaning between teeth can help remove plaque and food debris from areas a toothbrush may miss.',
      'Floss, interdental brushes or other interdental tools may be appropriate depending on the person.'
    ],
    avoid: ['Do not claim flossing alone prevents every gum problem.'],
    angles: [
      ['brush-misses', 'Your toothbrush misses these areas'],
      ['floss-or-brush', 'Floss or interdental brush: what is the difference?'],
      ['habit', 'The tiny habit your evening routine may be missing']
    ]
  },
  {
    id: 'cavities-001', topic: 'How cavities develop', pillar: 'education', engagement: 89,
    services: ['general dentistry','restorative dentistry'],
    facts: [
      'Tooth decay develops when acids produced by plaque bacteria repeatedly attack tooth enamel.',
      'Frequent exposure to sugary foods and drinks can increase the time teeth are exposed to acid.',
      'Early decay may not always cause pain.'
    ],
    avoid: ['Do not say sugar directly drills holes in teeth.', 'Do not diagnose a cavity based on symptoms alone.'],
    angles: [
      ['no-pain', 'Can you have a cavity without pain?'],
      ['snacking', 'Why frequent snacking matters to your teeth'],
      ['process', 'What actually happens when a cavity starts?']
    ]
  },
  {
    id: 'whitening-001', topic: 'Professional teeth whitening', pillar: 'treatment', engagement: 94,
    services: ['teeth whitening','cosmetic dentistry'],
    facts: [
      'Whitening treatments are intended to lighten tooth colour, but results vary by person and by the cause of discoloration.',
      'Dental restorations such as crowns and fillings do not whiten in the same way as natural tooth structure.',
      'Temporary sensitivity can occur with tooth whitening.'
    ],
    avoid: ['Do not guarantee a shade change.', 'Do not say whitening is suitable for everyone.'],
    angles: [
      ['restorations', 'Why crowns do not whiten like natural teeth'],
      ['sensitivity', 'Whitening and sensitivity: what patients often ask'],
      ['expectations', 'What whitening can — and cannot — change']
    ]
  },
  {
    id: 'aligners-001', topic: 'Clear aligners', pillar: 'treatment', engagement: 95,
    services: ['invisalign','clear aligners','orthodontics'],
    facts: [
      'Clear aligners are removable orthodontic appliances used to move teeth gradually in selected cases.',
      'Treatment suitability and duration depend on the individual case.',
      'Wearing aligners as instructed is important to the planned tooth movement.'
    ],
    avoid: ['Do not promise a treatment duration.', 'Do not claim aligners are suitable for every case.'],
    angles: [
      ['wear-time', 'What happens if you do not wear aligners as instructed?'],
      ['food', 'Can you eat normally with clear aligners?'],
      ['first-visit', 'What happens at a clear-aligner consultation?']
    ]
  },
  {
    id: 'veneers-001', topic: 'Dental veneers', pillar: 'treatment', engagement: 91,
    services: ['veneers','cosmetic dentistry'],
    facts: [
      'Veneers are thin restorations placed over the front surface of selected teeth.',
      'Different veneer materials and preparation approaches exist.',
      'Whether veneers are appropriate depends on tooth condition, bite, goals and clinical assessment.'
    ],
    avoid: ['Do not describe veneers as reversible in all cases.', 'Do not guarantee a cosmetic outcome.'],
    angles: [
      ['right-for-you', 'Who might consider veneers — and who needs an assessment first?'],
      ['not-filter', 'Veneers are not an Instagram filter: what actually changes'],
      ['questions', 'Questions to ask before choosing veneers']
    ]
  },
  {
    id: 'implants-001', topic: 'Dental implants', pillar: 'treatment', engagement: 90,
    services: ['dental implants','implant dentistry'],
    facts: [
      'A dental implant is placed in the jawbone to support a replacement tooth or teeth.',
      'Planning may involve assessment of oral health, bone, medical history and the intended restoration.',
      'Treatment timelines vary and can involve more than one stage.'
    ],
    avoid: ['Do not promise same-day treatment.', 'Do not claim implants last forever.'],
    angles: [
      ['stages', 'Why implant treatment can happen in stages'],
      ['planning', 'What dentists assess before an implant'],
      ['myth', 'Myth vs fact: dental implants']
    ]
  },
  {
    id: 'root-canal-001', topic: 'Root canal treatment', pillar: 'treatment', engagement: 93,
    services: ['root canal treatment','endodontics'],
    facts: [
      'Root canal treatment is used to treat infection or inflammation inside a tooth.',
      'The procedure removes affected tissue inside the tooth, cleans the space and seals it.',
      'Symptoms vary, and only a dental assessment can determine whether root canal treatment is needed.'
    ],
    avoid: ['Do not say root canal treatment is always painless.', 'Do not diagnose from pain alone.'],
    angles: [
      ['what-it-does', 'What a root canal actually does'],
      ['pain-myth', 'Does a root canal always hurt?'],
      ['save-tooth', 'How root canal treatment can help preserve a tooth']
    ]
  },
  {
    id: 'wisdom-teeth-001', topic: 'Wisdom teeth', pillar: 'faq', engagement: 88,
    services: ['oral surgery','wisdom tooth removal','general dentistry'],
    facts: [
      'Wisdom teeth do not always need removal.',
      'Removal may be considered when a wisdom tooth is causing or is likely to cause specific problems.',
      'Assessment can include symptoms, examination and imaging when appropriate.'
    ],
    avoid: ['Do not say every wisdom tooth must be removed.'],
    angles: [
      ['always-remove', 'Do wisdom teeth always need to come out?'],
      ['signs', 'Why dentists sometimes monitor wisdom teeth instead of removing them'],
      ['assessment', 'What happens during a wisdom-tooth assessment?']
    ]
  },
  {
    id: 'scaling-001', topic: 'Professional dental cleaning', pillar: 'myth', engagement: 97,
    services: ['scaling','dental cleaning','preventive dentistry'],
    facts: [
      'Professional cleaning removes plaque and hardened deposits from tooth surfaces.',
      'Removing deposits can reveal spaces or tooth surfaces that were already present underneath them.',
      'A cleaning appointment does not create new gaps between healthy teeth.'
    ],
    avoid: ['Do not claim scaling creates gaps.', 'Do not promise a pain-free experience.'],
    angles: [
      ['gap-myth', 'Does scaling create gaps between your teeth?'],
      ['what-removed', 'What actually comes off during a dental cleaning?'],
      ['after-feel', 'Why your teeth can feel different after scaling']
    ]
  },
  {
    id: 'bad-breath-001', topic: 'Bad breath', pillar: 'faq', engagement: 90,
    services: ['general dentistry','gum care'],
    facts: [
      'Bad breath can have several causes, including oral hygiene, dry mouth, foods and some health conditions.',
      'Persistent bad breath can sometimes be related to dental or gum problems.',
      'An assessment is useful when bad breath continues despite routine oral hygiene.'
    ],
    avoid: ['Do not attribute all bad breath to poor hygiene.'],
    angles: [
      ['after-brushing', 'Bad breath even after brushing?'],
      ['causes', 'Not all bad breath comes from the same place'],
      ['when-check', 'When persistent bad breath is worth checking']
    ]
  },
  {
    id: 'dry-mouth-001', topic: 'Dry mouth', pillar: 'education', engagement: 78,
    services: ['general dentistry','preventive dentistry'],
    facts: [
      'Saliva helps lubricate the mouth and contributes to oral protection.',
      'Dry mouth can have several causes, including some medicines and health conditions.',
      'Ongoing dry mouth may increase oral discomfort and can affect oral health.'
    ],
    avoid: ['Do not tell people to stop prescribed medicines.'],
    angles: [
      ['why-matters', 'Why saliva matters more than most people realise'],
      ['medicines', 'Dry mouth and medicines: a question worth asking'],
      ['night', 'Waking up with a dry mouth?']
    ]
  },
  {
    id: 'kids-first-visit-001', topic: 'A child’s dental visit', pillar: 'trust', engagement: 87,
    services: ['pediatric dentistry','family dentistry'],
    facts: [
      'Regular dental visits can help monitor a child’s teeth, gums and developing bite.',
      'Positive, age-appropriate dental experiences can help children become familiar with dental care.',
      'Parents can help by using calm, simple language before a visit.'
    ],
    avoid: ['Do not promise a child will not feel anxious.'],
    angles: [
      ['prepare', 'How to prepare your child for a dental visit'],
      ['what-happens', 'What usually happens at a child-friendly check-up?'],
      ['words', 'What not to say before your child’s dental appointment']
    ]
  },
  {
    id: 'toothbrush-001', topic: 'When to replace a toothbrush', pillar: 'prevention', engagement: 76,
    services: ['general dentistry','preventive dentistry'],
    facts: [
      'A toothbrush or brush head should be replaced when bristles become worn or frayed.',
      'A worn brush may clean less effectively and can feel rough on gums.',
      'Replacement timing also depends on how quickly the bristles wear.'
    ],
    avoid: ['Do not give one rigid replacement interval as suitable for everyone.'],
    angles: [
      ['look-at-bristles', 'Your toothbrush can tell you when it is done'],
      ['frayed', 'Frayed bristles? It may be time for a change'],
      ['pressure', 'What worn bristles can reveal about brushing pressure']
    ]
  },
  {
    id: 'acidic-drinks-001', topic: 'Acidic drinks and enamel', pillar: 'prevention', engagement: 86,
    services: ['general dentistry','preventive dentistry'],
    facts: [
      'Frequent exposure to acidic drinks can contribute to enamel erosion over time.',
      'The frequency of acid exposure can matter, not only the total amount consumed.',
      'Water is a tooth-friendly choice between meals.'
    ],
    avoid: ['Do not claim one drink causes irreversible damage.'],
    angles: [
      ['sipping', 'Why sipping an acidic drink for hours matters'],
      ['sports-drinks', 'Sports drinks and enamel: what to know'],
      ['frequency', 'For your teeth, frequency can matter as much as quantity']
    ]
  },
  {
    id: 'night-grinding-001', topic: 'Teeth grinding', pillar: 'faq', engagement: 89,
    services: ['general dentistry','night guard','tmj'],
    facts: [
      'Teeth grinding or clenching can happen while awake or during sleep.',
      'Some people notice jaw soreness, headaches or tooth wear, while others have few symptoms.',
      'A dentist can assess teeth, jaw symptoms and possible management options.'
    ],
    avoid: ['Do not claim a night guard cures the cause of grinding.'],
    angles: [
      ['morning-jaw', 'Waking up with a tired jaw?'],
      ['silent', 'You may grind your teeth without knowing it'],
      ['signs', 'Clues your teeth may be under extra pressure']
    ]
  },
  {
    id: 'dental-emergency-001', topic: 'Dental emergencies', pillar: 'action', engagement: 95,
    services: ['emergency dentistry','general dentistry'],
    facts: [
      'Dental injuries and severe dental symptoms can require prompt professional assessment.',
      'A knocked-out permanent tooth is time-sensitive and urgent dental advice should be sought promptly.',
      'Severe swelling, trauma or uncontrolled bleeding can require urgent medical or dental attention.'
    ],
    avoid: ['Do not replace emergency assessment with social-media advice.', 'Do not give medication dosages.'],
    angles: [
      ['knocked-out', 'A tooth gets knocked out — what matters next?'],
      ['urgent', 'Which dental problems should not wait?'],
      ['save-number', 'The dental emergency checklist worth saving']
    ]
  },
  {
    id: 'checkup-001', topic: 'Dental check-ups', pillar: 'trust', engagement: 79,
    services: ['general dentistry','preventive dentistry'],
    facts: [
      'Dental check-up intervals can vary according to a person’s oral health and risk factors.',
      'A check-up can include assessment of teeth, gums and other oral tissues.',
      'Routine visits can help identify changes before they become obvious to the patient.'
    ],
    avoid: ['Do not prescribe a single check-up interval for everyone.'],
    angles: [
      ['why-go', 'Why visit the dentist when nothing hurts?'],
      ['what-check', 'What your dentist is actually checking'],
      ['interval', 'How often should you have a dental check-up? It depends']
    ]
  },
  {
    id: 'mouthwash-001', topic: 'Mouthwash', pillar: 'myth', engagement: 83,
    services: ['general dentistry','preventive dentistry'],
    facts: [
      'Mouthwash can be useful in some oral-care routines, but it does not replace brushing and cleaning between teeth.',
      'Different mouthwashes are intended for different purposes.',
      'A dentist can advise whether a particular mouthwash suits an individual need.'
    ],
    avoid: ['Do not say every person needs mouthwash.'],
    angles: [
      ['replace-brushing', 'Can mouthwash replace brushing?'],
      ['which-one', 'Why all mouthwashes are not the same'],
      ['routine', 'Where mouthwash actually fits in an oral-care routine']
    ]
  },
  {
    id: 'pregnancy-001', topic: 'Oral health during pregnancy', pillar: 'education', engagement: 84,
    services: ['general dentistry','family dentistry'],
    facts: [
      'Hormonal changes during pregnancy can affect gums in some people.',
      'Routine oral hygiene and dental care remain important during pregnancy.',
      'Patients should tell their dental team if they are pregnant or may be pregnant.'
    ],
    avoid: ['Do not give obstetric advice.', 'Do not imply dental treatment is universally unsafe during pregnancy.'],
    angles: [
      ['gums', 'Why gums can behave differently during pregnancy'],
      ['tell-dentist', 'Pregnant? One thing your dental team should know'],
      ['routine', 'Pregnancy is not a reason to ignore your oral health']
    ]
  },
  {
    id: 'sports-guard-001', topic: 'Sports mouthguards', pillar: 'prevention', engagement: 81,
    services: ['sports dentistry','general dentistry'],
    facts: [
      'Mouthguards can help reduce the risk and severity of some dental injuries during contact or collision sports.',
      'Fit and condition affect how a mouthguard performs.',
      'A dental professional can discuss mouthguard options for an individual.'
    ],
    avoid: ['Do not say a mouthguard prevents all injuries.'],
    angles: [
      ['worth-it', 'Is a mouthguard really worth it?'],
      ['fit', 'Why mouthguard fit matters'],
      ['replace', 'When your sports mouthguard needs another look']
    ]
  },
  {
    id: 'before-after-001', topic: 'Before-and-after smile content', pillar: 'trust', engagement: 93,
    services: ['cosmetic dentistry','veneers','teeth whitening','clear aligners'],
    facts: [
      'Before-and-after images should represent a real patient result only when the clinic has appropriate permission to use them.',
      'Results vary between patients and images should not imply guaranteed outcomes.',
      'Treatment context matters when interpreting a cosmetic result.'
    ],
    avoid: ['Never fabricate a patient result.', 'Never imply identical outcomes are guaranteed.'],
    angles: [
      ['story', 'The treatment story behind a smile change'],
      ['context', 'Before-and-after: what the image does not tell you'],
      ['realistic', 'Why every smile plan starts with an individual assessment']
    ]
  }
]);

export const CONTENT_CARD_VERSION = '2026-10-02.1';
