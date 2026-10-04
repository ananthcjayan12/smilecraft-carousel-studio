// Demo clinics for hackathon/pitch demos. Fictional clinics; contact numbers use ACMA ranges
// reserved for fiction. Sources are paths inside dental_dummy_explanation_pack (raw pack, not
// committed); build-assets.mjs turns them into ASSET_DIR, which seed.mjs uploads.
export const ASSET_DIR = 'demo/clinic-assets';
const ADA = { title: 'Australian Dental Association — Teeth.org.au', url: 'https://www.teeth.org.au/' };
const R = '01_Batch_1_Rosebay_Content/', M = '02_Batch_2_Mixed_Content/', H = '03_Batch_3_Harbour_Content/';
const frame = (source, heading, body, visualPrompt) => ({ source, heading, body, visualPrompt });

export const DEMO_CLINICS = [
  {
    key: 'rosebay', name: 'Rosebay Family Dental',
    logo: '04_Logos_and_Style_Boards/Rosebay_Family_Dental/01_Logo/rosebay_family_dental_logo.png',
    profile: { location: 'Sydney', tone: 'warm, gentle and family-friendly', services: ['Family check-ups', "Children's dentistry", 'Whitening consultations', 'Cosmetic consultations'] },
    brand: { primary: '#5a1f33', accent: '#c98585', phone: '(02) 5550 2471', whatsapp: '0491 570 156', address: 'Rose Bay, Sydney NSW' },
    styles: [
      { key: 'style-family', name: 'Rose Editorial', source: '04_Logos_and_Style_Boards/Rosebay_Family_Dental/02_Style_Boards/rosebay_family_dental_carousel.png' },
      { key: 'style-care', name: 'Blush Smile Care', source: '04_Logos_and_Style_Boards/Rosebay_Family_Dental/02_Style_Boards/rosebay_family_dental_smile_care_carousel.png' },
      { key: 'style-journey', name: 'Smile Journey', source: '04_Logos_and_Style_Boards/Rosebay_Family_Dental/02_Style_Boards/rosebay_family_dental_smile_journey.png' }
    ],
    items: [
      { key: 'whitening', type: 'carousel', topic: 'Whitening without the pressure',
        summary: 'Many patients are curious about whitening but unsure where to start. This carousel explains why teeth stain, the main whitening approaches, and why a consultation helps match options to each smile.',
        facts: ['Surface stains from coffee, tea and wine differ from deeper changes in tooth shade.', 'Whitening options include in-chair, take-home and maintenance approaches chosen with a dentist.'],
        frames: [
          frame(R + 'a_smile_refresh_consultation.png', 'A smile refresh, without the pressure.', 'Explore whitening or cosmetic options at your own pace.', 'Dentist showing a shade guide to a relaxed patient in a bright blush-toned clinic'),
          frame(R + 'understanding_tooth_staining_causes.png', 'What causes tooth staining?', 'Surface stains from coffee, tea and wine are different from deeper shade changes.', 'Cross-section of a tooth showing surface stains and inner dentine'),
          frame(R + 'whitening_options_at_rosebay_dental.png', 'Whitening isn’t one-size-fits-all.', 'Your dentist can guide you through in-chair, take-home and maintenance options.', 'Three tooth models on pedestals representing in-chair, take-home and maintenance whitening'),
          frame(R + 'see_the_shade_together.png', 'See the shade, together.', 'A consultation helps match your goals with the right approach.', 'Dentist and patient comparing a shade guide together'),
          frame(R + 'rosebay_dental_whitening_consultation.png', 'Thinking about whitening?', 'Ask about gentle, personalised options at your consultation.', 'Smiling patient holding a hand mirror after a consultation')
        ],
        caption: 'Thinking about a brighter smile? ✨ Whitening isn’t one-size-fits-all — stains from coffee, tea and wine behave differently from deeper shade changes, and the right option depends on your teeth and goals.\n\nAt Rosebay Family Dental we’ll look at your shade together and talk through in-chair, take-home and maintenance options — no pressure.\n\nBook a whitening consultation: (02) 5550 2471\n\n#RosebayFamilyDental #TeethWhitening #SydneyDentist' },
      { key: 'first-visit', type: 'carousel', topic: 'Your child’s first dental visit',
        summary: 'A first dental visit can feel big for little ones. This carousel gives parents simple ways to prepare at home, explains what the dentist checks, and celebrates small wins that build confidence.',
        facts: ['A first visit often focuses on teeth, gums, bite and cleaning habits.', 'Familiar routines and comfort items can help children feel safer in a new place.'],
        frames: [
          frame(R + 'gentle_comfort_at_rosebay_dental.png', 'Big feelings before a visit?', 'Small comforts, gentle words and a familiar routine can help.', 'Parent hugging a young child holding a plush bunny in a calm waiting room'),
          frame(R + 'start_at_home_family_dental_moments.png', 'Start at home.', 'Talk about counting teeth, meeting the dentist and asking questions.', 'Parent reading a toothbrushing picture book with a child at home'),
          frame(R + 'what_your_dentist_checks.png', 'What your dentist checks.', 'A first visit often focuses on teeth, gums, bite and cleaning habits.', 'Glossy tooth model with labelled callouts for teeth, gums, bite and brushing'),
          frame(R + 'comfort_at_rosebay_family_dental.png', 'Bring a comfort item.', 'A favourite toy or a familiar routine can make a new place feel safer.', 'Child with a plush toy smiling at a friendly dentist'),
          frame(R + 'little_wins_at_rosebay_dental.png', 'Little wins matter.', 'One calm visit can build big confidence. Book a family visit.', 'Dentist high-fiving a happy child in the dental chair')
        ],
        caption: 'Your child’s first dental visit doesn’t have to feel scary. 🧸\n\nTalk about it at home, bring a favourite toy, and know what to expect: a gentle look at teeth, gums, bite and brushing habits. Every calm visit is a little win!\n\nBook a family visit with Rosebay Family Dental: (02) 5550 2471\n\n#RosebayFamilyDental #KidsDentist #FirstDentalVisit' },
      { key: 'listening', type: 'post', topic: 'Real care starts with listening',
        summary: 'A short reassurance post: a calm, two-way conversation before treatment helps patients feel heard and more comfortable.',
        facts: ['Discussing concerns and preferences before treatment can make a dental visit feel calmer.'],
        frames: [frame(M + '02_Harbour_Gum/real_care_starts_with_listening.png', 'Real care starts with listening.', 'A calm conversation can change how a dental visit feels.', 'Dentist chatting warmly with a seated patient before treatment')],
        caption: 'Every visit at Rosebay starts with a conversation. 💬 Tell us what matters to you — questions, worries or goals — and we’ll take it from there.\n\nCall (02) 5550 2471 to book.\n\n#RosebayFamilyDental #GentleDentistry' },
      // Left without artwork on purpose: press "Create remaining artwork" during the demo to generate it live.
      { key: 'brushing', type: 'post', topic: 'Two minutes, twice a day', live: true,
        summary: 'A practical habit post for families: brushing for two minutes, morning and night, with a pea-sized amount of fluoride toothpaste helps protect growing teeth.',
        facts: ['Brush teeth twice a day for about two minutes.', 'Children aged 6 and over can use a pea-sized amount of fluoride toothpaste; younger children need less.'],
        frames: [frame(null, 'Two minutes, twice a day.', 'Brushing morning and night with a pea-sized amount of fluoride toothpaste helps protect growing smiles. Ask us for tips at your child’s next visit.', 'A parent and young child brushing teeth together at a bright bathroom sink, soft blush tones, plush bunny on the counter')],
        caption: 'Small habit, big difference. 🪥 Two minutes, morning and night, with a pea-sized amount of fluoride toothpaste helps protect growing smiles.\n\nWant brushing tips for your little one? Ask us at your next visit — (02) 5550 2471.\n\n#RosebayFamilyDental #KidsTeeth #BrushingTips' },
      { key: 'bravery', type: 'story', topic: 'Little steps, big bravery',
        summary: 'A warm story for parents: a gentle first visit can start with comfort, calm words and a familiar face.',
        facts: ['A gentle first visit can help children build confidence at the dentist.'],
        frames: [frame(M + '01_Rosebay/little_steps_big_bravery.png', 'Little steps. Big bravery.', 'A gentle first visit can start with comfort, calm words and a familiar face.', 'Parent hugging a smiling child holding a plush bunny in the dental chair')],
        caption: 'Little steps, big bravery. 💗 Family visits at Rosebay Family Dental, Sydney.' },
      { key: 'smile-goals', type: 'story', topic: 'Smile goals? Start with a consult',
        summary: 'A story inviting adults to talk through shade and whitening options in a relaxed consultation.',
        facts: ['A consultation helps match whitening options to your goals.'],
        frames: [frame(M + '01_Rosebay/smile_goals_whitening_consult.png', 'Smile goals? Start with a consult.', 'Let’s talk through shade, options and what may suit your smile.', 'Dentist showing a shade guide to a smiling patient holding a mirror')],
        caption: 'Smile goals? ✨ Start with a whitening consult at Rosebay Family Dental.' }
    ]
  },
  {
    key: 'harbourgum', name: 'Harbour Gum Dental',
    logo: '04_Logos_and_Style_Boards/Harbour_Gum_Dental/01_Logo/harbour_gum_dental_logo.png',
    profile: { location: 'Melbourne', tone: 'calm, clear and reassuring', services: ['Check-ups', 'Sensitive teeth assessments', 'Gum care', 'Support for anxious patients'] },
    brand: { primary: '#0b4a52', accent: '#2fe0dc', phone: '(03) 7010 4632', whatsapp: '0491 570 157', address: 'Melbourne VIC' },
    styles: [
      { key: 'style-board', name: 'Harbour Teal', source: '04_Logos_and_Style_Boards/Harbour_Gum_Dental/02_Style_Boards/harbour_gum_dental_carousel_board.png' },
      { key: 'style-care', name: 'Teal Care', source: '04_Logos_and_Style_Boards/Harbour_Gum_Dental/02_Style_Boards/harbour_gum_dental_care_carousel.png' },
      { key: 'style-smile', name: 'Eucalyptus Smile Care', source: '04_Logos_and_Style_Boards/Harbour_Gum_Dental/02_Style_Boards/harbour_gum_dental_smile_care_carousel.png' }
    ],
    items: [
      { key: 'sensitivity', type: 'carousel', topic: 'Sensitive teeth: start with the cause',
        summary: 'Sensitivity to cold, sweet or acidic foods can have several causes. This carousel explains why teeth feel sharp, what a dentist looks for, and why the right care depends on the cause.',
        facts: ['Sensitivity can be linked to enamel wear, exposed roots, cracks or decay.', 'The right toothpaste, home care and treatment depend on the cause.'],
        frames: [
          frame(M + '02_Harbour_Gum/sensitive_teeth_start_with_the_cause.png', 'Sensitive teeth? Start with the cause.', 'Cold, sweet or acidic triggers can point to a few different issues.', 'Patient holding a cold drink while a dentist explains on a tablet'),
          frame(M + '01_Rosebay/why_tooth_sensitivity_feels_sharp.png', 'Why it can feel sharp.', 'When protective layers thin out, heat, cold or sweetness can reach the sensitive inner tooth.', 'Glowing tooth cross-section showing enamel, dentine and nerve with cold, heat and sweet triggers'),
          frame(M + '01_Rosebay/dental_tooth_anatomy_infographic.png', 'What your dentist may look for.', 'Sensitivity can be linked to enamel wear, exposed roots, cracks or decay.', 'Tooth model with callouts for enamel wear, gum recession, crack and decay'),
          frame(M + '02_Harbour_Gum/small_changes_healthier_smiles.png', 'Small changes can help.', 'The right toothpaste, home care advice and treatment plan depend on the cause.', 'Dentist recommending a toothpaste to a smiling patient'),
          frame(M + '01_Rosebay/comfort_starts_with_clarity.png', 'Comfort starts with clarity.', 'Ask our team about a check-up for sensitive teeth.', 'Dentist showing a tooth model to a relaxed patient by a city-view window')
        ],
        caption: 'Does cold water or something sweet make your teeth zing? ❄️🍦\n\nSensitivity can come from enamel wear, exposed roots, cracks or decay — so the right fix depends on the cause. A check-up helps us find it and suggest the right toothpaste, home care or treatment.\n\nBook a sensitivity check-up at Harbour Gum Dental: (03) 7010 4632\n\n#HarbourGumDental #SensitiveTeeth #MelbourneDentist' },
      { key: 'calm-visit', type: 'carousel', topic: 'A calmer dental visit',
        summary: 'For patients who feel nervous about the dentist: sharing worries, asking questions and taking things at your own pace can make visits feel more manageable.',
        facts: ['Knowing what to expect can make an appointment feel more predictable.', 'Pauses, clear explanations and step-by-step support can help anxious patients.'],
        frames: [
          frame(M + '02_Harbour_Gum/calmer_dental_consultation_at_harbour_gum.png', 'A calmer visit starts with a conversation.', 'Questions, concerns and comfort preferences are always welcome.', 'Dentist with a tablet chatting with a patient in a bright Melbourne clinic'),
          frame(H + 'harbour_gum_dental_consultation_carousel.png', 'Tell us what feels hard.', 'Your questions, worries and comfort preferences help shape the visit.', 'Dentist listening attentively to a patient'),
          frame(H + 'bring_your_questions_to_harbour_gum.png', 'Bring your questions.', 'Knowing what to expect can make an appointment feel more predictable.', 'Dentist showing next steps on a tablet to a patient'),
          frame(H + 'care_at_your_pace_dental_consultation.png', 'Care at your pace.', 'Small pauses, clear explanations and step-by-step support can help.', 'Dentist explaining with a tooth model while the patient relaxes'),
          frame(H + 'comfortable_care_at_harbour_gum_dental.png', 'You deserve comfortable care.', 'Ask our team about a visit that works for you.', 'Dentist welcoming a smiling patient at reception')
        ],
        caption: 'Nervous about the dentist? You’re not alone. 🌿\n\nAt Harbour Gum Dental, every visit starts with a conversation. Tell us what feels hard, bring your questions, and we’ll go at your pace with clear explanations and breaks whenever you need them.\n\nAsk our team about a visit that works for you: (03) 7010 4632\n\n#HarbourGumDental #DentalAnxiety #MelbourneDentist' },
      { key: 'questions', type: 'post', topic: 'Bring your questions',
        summary: 'A friendly invitation to bring questions to the next appointment so patients know what to expect.',
        facts: ['Knowing what to expect can make a visit feel more manageable.'],
        frames: [frame(H + 'bring_your_questions_to_harbour_gum_dental.png', 'Bring your questions.', 'Knowing what to expect can make a visit feel more manageable. Book now.', 'Dentist reviewing a tablet with an engaged patient')],
        caption: 'No question is too small. 🙋 Knowing what to expect makes a visit feel more manageable — bring your questions and we’ll walk through them together.\n\nBook now: (03) 7010 4632\n\n#HarbourGumDental' },
      { key: 'your-pace', type: 'post', topic: 'Care at your pace',
        summary: 'A reassurance post: supportive, unhurried care can make dental visits feel calmer and clearer.',
        facts: ['Supportive care can help visits feel calmer and more comfortable.'],
        frames: [frame(H + 'calm_care_at_harbour_gum_dental.png', 'Care at your pace.', 'Supportive care can feel calmer, clearer and more comfortable. Ask our team.', 'Relaxed patient smiling at a dentist holding a tablet')],
        caption: 'Care at your pace. 🌿 Calmer, clearer and more comfortable — ask our team how we can make your next visit easier. (03) 7010 4632\n\n#HarbourGumDental #GentleDentistry' },
      { key: 'nervous', type: 'story', topic: 'Nervous about the dentist?',
        summary: 'A story for anxious patients: you are not the only one, and gentle explanations can help.',
        facts: ['Gentle explanations can help nervous patients feel more at ease.'],
        frames: [frame(H + 'gentle_dental_care_in_melbourne.png', 'Nervous about the dentist?', 'You’re not the only one. Gentle explanations can help.', 'Dentist reassuring a patient in a calm clinic with city views')],
        caption: 'Nervous about the dentist? You’re not the only one. 🌿 Harbour Gum Dental, Melbourne.' },
      { key: 'sensitive-check', type: 'story', topic: 'Sensitive teeth? Book a check-up',
        summary: 'A story inviting people with sensitive teeth to book a check-up to understand the cause.',
        facts: ['A check-up can help identify the cause of tooth sensitivity.'],
        frames: [frame(H + 'sensitive_teeth_harbour_gum_dental_check_up.png', 'Sensitive teeth?', 'A check-up can help you understand the cause. Book a check-up.', 'Patient touching their cheek while a dentist explains on a tablet')],
        caption: 'Sensitive teeth? A check-up can help you understand the cause. Book with Harbour Gum Dental.' }
    ]
  }
].map(c => ({ ...c, items: c.items.map(i => ({ ...i, sources: [ADA] })) }));
