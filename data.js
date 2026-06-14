/* =============================================================
   SkillOS — Sample roadmap data
   The structure is a tree of nodes:
     { id, title, done, notes, resources: [{label,url}], children: [] }
   ============================================================= */

window.SAMPLE_ROADMAPS = (function () {

  // Internal ID generator (data-side only). The app will regenerate IDs
  // on import if collisions are detected.
  let __id = 0;
  const nid = () => `n_${Date.now().toString(36)}_${(__id++).toString(36)}`;

  /** Build a leaf node. */
  const t = (title) => ({
    id: nid(),
    title,
    done: false,
    notes: '',
    resources: [],
    children: [],
    expanded: false,
  });

  /** Build a branch node. */
  const b = (title, children = [], expanded = false) => ({
    id: nid(),
    title,
    done: false,
    notes: '',
    resources: [],
    children,
    expanded,
  });

  // ===== AI Engineer roadmap =====
  const aiEngineer = {
    id: 'roadmap_ai_engineer',
    name: 'AI Engineer',
    description: 'Master the full stack of modern AI engineering — from Python fundamentals to deploying production AI systems.',
    createdAt: Date.now(),
    children: [
      b('Programming Foundations', [
        b('Python', [
          t('Variables'),
          t('Data Types'),
          t('Operators'),
          t('Conditions'),
          t('Loops'),
          t('Functions'),
          t('OOP'),
          t('File Handling'),
          t('Error Handling'),
          t('Projects'),
        ]),
        b('Git', [
          t('Repositories'),
          t('Commits'),
          t('Branches'),
          t('GitHub'),
        ]),
        t('Command Line'),
      ], true),

      b('Data Foundations', [
        b('NumPy', [
          t('Arrays'),
          t('Indexing'),
          t('Broadcasting'),
          t('Operations'),
        ]),
        b('Pandas', [
          t('DataFrames'),
          t('Cleaning'),
          t('Filtering'),
          t('Aggregation'),
          t('Analysis'),
        ]),
        b('Data Visualization', [
          t('Matplotlib'),
          t('Seaborn'),
          t('Dashboarding'),
        ]),
      ]),

      b('Mathematics', [
        b('Statistics', [
          t('Mean'),
          t('Median'),
          t('Variance'),
          t('Probability'),
        ]),
        b('Linear Algebra', [
          t('Vectors'),
          t('Matrices'),
          t('Transformations'),
        ]),
        b('Calculus', [
          t('Derivatives'),
          t('Gradients'),
          t('Optimization'),
        ]),
      ]),

      b('Machine Learning', [
        b('Fundamentals', [
          t('Supervised Learning'),
          t('Unsupervised Learning'),
          t('Train/Test Split'),
          t('Evaluation'),
        ]),
        b('Algorithms', [
          t('Linear Regression'),
          t('Logistic Regression'),
          t('Decision Trees'),
          t('Random Forest'),
          t('SVM'),
          t('Clustering'),
        ]),
        t('Scikit-Learn'),
      ]),

      b('Deep Learning', [
        b('Neural Networks', [
          t('Neurons'),
          t('Activation Functions'),
          t('Forward Pass'),
          t('Backpropagation'),
        ]),
        t('PyTorch'),
        t('TensorFlow'),
        t('CNN'),
        t('RNN'),
        t('Transformers'),
      ]),

      b('AI Specializations', [
        t('Computer Vision'),
        t('NLP'),
        t('Generative AI'),
        t('LLM Engineering'),
        t('Agent Systems'),
      ]),

      b('Deployment', [
        b('APIs', [
          t('FastAPI'),
          t('REST'),
        ]),
        t('Docker'),
        b('Cloud', [
          t('AWS'),
          t('GCP'),
          t('Azure'),
        ]),
        t('MLOps'),
      ]),

      b('Portfolio Projects', [
        t('Calculator'),
        t('Data Dashboard'),
        t('House Price Predictor'),
        t('Image Classifier'),
        t('Chatbot'),
        t('RAG System'),
        t('AI Agent'),
        t('Production AI App'),
      ]),
    ],
  };

  return [aiEngineer];
})();
